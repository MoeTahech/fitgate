import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { resetDatabase } from "../../../../tests/support/database";
import {
  createCouplesPlan,
  createFreeze,
  createMembershipInvite,
  createOwnedMembership,
  createPlan,
  createSeat,
  createUser,
} from "../../../../tests/support/factories";
import { expectMembershipError } from "../../../../tests/support/membership-errors";
import { refundPayment, voidPayment, type RefundPaymentInput, type VoidPaymentInput } from "./corrections";
import { approveFreeze, requestFreeze } from "./freezes";
import { createManualMembership, extendManualMembership } from "./manual";
import { remainingUsableMs } from "./rules";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Wednesday 2 December 2026, 10:00 in Beirut (UTC+2). The gym is open 06:00-22:00 every day.
const NOW = new Date("2026-12-02T08:00:00.000Z");
const ONE_MONTH_LATER = new Date("2027-01-02T08:00:00.000Z");
const TWO_MONTHS_LATER = new Date("2027-02-02T08:00:00.000Z");
const MISSING_ID = "0190f2a0-0000-7000-8000-000000000000";
const REASON = "Recorded on the wrong member";

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await resetDatabase();
  await db.gymSettings.create({ data: { id: 1, name: "Gym", timeZone: "Asia/Beirut", capacity: 50 } });
  await db.openingHours.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAtMin: 360, closesAtMin: 1320 })),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function voidIt(admin: { id: string }, paymentId: string, overrides: Partial<VoidPaymentInput> = {}) {
  return voidPayment({ actorId: admin.id, paymentId, reason: REASON, ipHash: "ip", ...overrides });
}

function refund(admin: { id: string }, paymentId: string, amountCents: number, overrides: Partial<RefundPaymentInput> = {}) {
  return refundPayment({ actorId: admin.id, paymentId, amountCents, reason: REASON, ipHash: "ip", ...overrides });
}

/** A member on a recurring plan, paid in cash for one month and extended by another (by Whish, with `reference`). */
async function extendedMembership(reference = "WH-1") {
  const admin = await createUser({ role: "ADMIN" });
  const member = await createUser();
  const plan = await createPlan({ priceCents: 3000 });
  const created = await createManualMembership({ actorId: admin.id, userId: member.id, planId: plan.id, method: "CASH" });
  const extension = await extendManualMembership({ actorId: admin.id, membershipId: created.membershipId, method: "WHISH", reference });
  return { admin, member, membershipId: created.membershipId, first: created.paymentId, second: extension.paymentId };
}

function getMembership(id: string) {
  return db.membership.findUniqueOrThrow({ where: { id } });
}

function getPayment(id: string) {
  return db.payment.findUniqueOrThrow({ where: { id } });
}

function auditRows(action: string) {
  return db.auditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } });
}

async function createStripePayment() {
  const member = await createUser();
  const membership = await createOwnedMembership(member, await createPlan(), { source: "STRIPE" });
  return db.payment.create({
    data: {
      membershipId: membership.id,
      userId: member.id,
      method: "STRIPE",
      status: "SUCCEEDED",
      amountCents: 3000,
      periodStart: membership.currentPeriodStart,
      periodEnd: membership.currentPeriodEnd,
      paidAt: membership.currentPeriodStart,
    },
  });
}

describe("voidPayment", () => {
  it("voids an extension and rolls the period end back to its start, auditing without the reason", async () => {
    const { admin, membershipId, second } = await extendedMembership();
    const later = at(3 * DAY);
    vi.setSystemTime(later);

    const result = await voidIt(admin, second, { reason: "  Entered twice  " });

    expect(result).toEqual({
      paymentId: second,
      membershipId,
      effect: { membership: "rolled_back", previousEnd: TWO_MONTHS_LATER, newEnd: ONE_MONTH_LATER, expired: false },
    });
    expect(await getPayment(second)).toMatchObject({
      status: "VOIDED",
      voidedAt: later,
      voidedById: admin.id,
      voidReason: "Entered twice",
      amountRefundedCents: 0,
    });
    expect(await getMembership(membershipId)).toMatchObject({
      status: "ACTIVE",
      currentPeriodStart: NOW,
      currentPeriodEnd: ONE_MONTH_LATER,
      endedAt: null,
    });

    expect(await auditRows("payment.voided")).toEqual([
      expect.objectContaining({
        actorId: admin.id,
        targetType: "payment",
        targetId: second,
        ipHash: "ip",
        createdAt: later,
        details: { membershipId, amountCents: 3000 },
      }),
    ]);
    expect(await auditRows("membership.period_rolled_back")).toEqual([
      expect.objectContaining({
        actorId: admin.id,
        targetType: "membership",
        targetId: membershipId,
        ipHash: "ip",
        createdAt: later,
        details: { paymentId: second, previousEnd: TWO_MONTHS_LATER.toISOString(), newEnd: ONE_MONTH_LATER.toISOString() },
      }),
    ]);
    expect(await auditRows("membership.ended")).toEqual([]);
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain("Entered twice");
  });

  it("voids the activating payment: cancels the membership, ends all seats, and revokes the pending invite", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const owner = await createUser();
    const partner = await createUser();
    const plan = await createCouplesPlan();
    const created = await createManualMembership({ actorId: admin.id, userId: owner.id, planId: plan.id, method: "CASH" });
    await createSeat(created.membershipId, partner.id, { role: "PARTNER", joinedAt: NOW });
    const invite = await createMembershipInvite(created.membershipId, owner.id, { createdAt: NOW });
    const later = at(2 * HOUR);
    vi.setSystemTime(later);

    const result = await voidIt(admin, created.paymentId);

    expect(result.effect).toEqual({ membership: "cancelled" });
    expect(await getMembership(created.membershipId)).toMatchObject({ status: "CANCELLED", endedAt: later, currentPeriodEnd: ONE_MONTH_LATER });
    expect(await db.membershipMember.findMany({ where: { membershipId: created.membershipId }, orderBy: { role: "asc" } })).toEqual([
      expect.objectContaining({ userId: owner.id, role: "OWNER", endedAt: later }),
      expect.objectContaining({ userId: partner.id, role: "PARTNER", endedAt: later }),
    ]);
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({
      status: "REVOKED",
      revokedAt: later,
      revokedById: null,
    });
    expect(await auditRows("membership.ended")).toEqual([
      expect.objectContaining({
        actorId: admin.id,
        targetId: created.membershipId,
        createdAt: later,
        details: { status: "CANCELLED", via: "void", paymentId: created.paymentId },
      }),
    ]);
    expect(await auditRows("membership.period_rolled_back")).toEqual([]);
  });

  it("only voids the latest valid payment, then the one before it", async () => {
    const { admin, membershipId, first, second } = await extendedMembership();

    await expectMembershipError(voidIt(admin, first), "NOT_LATEST_PAYMENT");
    expect((await getPayment(first)).status).toBe("SUCCEEDED");
    expect((await getMembership(membershipId)).currentPeriodEnd).toEqual(TWO_MONTHS_LATER);

    await voidIt(admin, second);
    const result = await voidIt(admin, first);

    expect(result.effect).toEqual({ membership: "cancelled" });
    expect((await getMembership(membershipId)).status).toBe("CANCELLED");
  });

  it("treats a partially refunded payment as valid: it blocks earlier voids and can't be voided itself", async () => {
    const { admin, first, second } = await extendedMembership();
    await refund(admin, second, 1000);

    await expectMembershipError(voidIt(admin, first), "NOT_LATEST_PAYMENT");
    await expectMembershipError(voidIt(admin, second), "HAS_REFUND");
    expect((await getPayment(second)).status).toBe("PARTIALLY_REFUNDED");
  });

  it("rejects a void on a fully refunded or already voided payment", async () => {
    const { admin, first, second } = await extendedMembership();
    await refund(admin, second, 3000);
    await expectMembershipError(voidIt(admin, second), "HAS_REFUND");

    await voidIt(admin, first);
    await expectMembershipError(voidIt(admin, first), "PAYMENT_NOT_VALID");
    expect(await auditRows("payment.voided")).toHaveLength(1);
  });

  it("rejects Stripe payments with NOT_MANUAL", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const payment = await createStripePayment();

    await expectMembershipError(voidIt(admin, payment.id), "NOT_MANUAL");
    expect(await getPayment(payment.id)).toEqual(payment);
  });

  it("expires the membership when the rollback leaves the period already over", async () => {
    const { admin, membershipId, second } = await extendedMembership();
    const later = at(35 * DAY);
    vi.setSystemTime(later);

    const result = await voidIt(admin, second);

    expect(result.effect).toEqual({
      membership: "rolled_back",
      previousEnd: TWO_MONTHS_LATER,
      newEnd: ONE_MONTH_LATER,
      expired: true,
    });
    expect(await getMembership(membershipId)).toMatchObject({
      status: "EXPIRED",
      currentPeriodEnd: ONE_MONTH_LATER,
      endedAt: ONE_MONTH_LATER,
    });
    expect(await db.membershipMember.findFirstOrThrow({ where: { membershipId } })).toMatchObject({ endedAt: ONE_MONTH_LATER });
    expect(await auditRows("membership.ended")).toEqual([
      expect.objectContaining({
        actorId: null,
        targetId: membershipId,
        createdAt: later,
        details: { status: "EXPIRED", via: "overdue_cleanup", trigger: "payment_void" },
      }),
    ]);
  });

  it("cancels open freezes that start at or after the new end, and keeps earlier ones", async () => {
    const beyond = await extendedMembership();
    const approved = await createFreeze(beyond.membershipId, beyond.member.id, {
      status: "APPROVED",
      startsAt: ONE_MONTH_LATER,
      endsAt: new Date(ONE_MONTH_LATER.getTime() + 7 * DAY),
      decidedById: beyond.admin.id,
    });
    const within = await extendedMembership("WH-2");
    const requested = await createFreeze(within.membershipId, within.member.id, {
      startsAt: at(10 * DAY),
      endsAt: at(17 * DAY),
    });

    await voidIt(beyond.admin, beyond.second);
    await voidIt(within.admin, within.second);

    expect((await db.membershipFreeze.findUniqueOrThrow({ where: { id: approved.id } })).status).toBe("CANCELLED");
    expect((await db.membershipFreeze.findUniqueOrThrow({ where: { id: requested.id } })).status).toBe("REQUESTED");
    expect(await auditRows("membership_freeze.cancelled")).toEqual([
      expect.objectContaining({
        actorId: beyond.admin.id,
        targetType: "membership_freeze",
        targetId: approved.id,
        details: { via: "period_rolled_back" },
      }),
    ]);
  });

  it("rolls back to the shifted boundary after an approved freeze, keeping the frozen days off the paid month", async () => {
    // Freeze 10-16 Dec (7 local days) falls in the first paid month, so approval moves the second payment's period.
    const { admin, member, membershipId, first, second } = await extendedMembership();
    const freeze = await requestFreeze({ userId: member.id, membershipId, firstDay: "2026-12-10", lastDay: "2026-12-16" });
    await approveFreeze({ actorId: admin.id, freezeId: freeze.freezeId });
    const shiftedBoundary = new Date(ONE_MONTH_LATER.getTime() + 7 * DAY);

    const result = await voidIt(admin, second);

    expect(result.effect).toEqual({
      membership: "rolled_back",
      previousEnd: new Date(TWO_MONTHS_LATER.getTime() + 7 * DAY),
      newEnd: shiftedBoundary,
      expired: false,
    });
    const membership = await db.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { plan: true } });
    expect(membership).toMatchObject({ status: "ACTIVE", currentPeriodEnd: shiftedBoundary });
    expect(await getPayment(first)).toMatchObject({ periodStart: NOW, periodEnd: shiftedBoundary });
    expect((await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.freezeId } })).status).toBe("APPROVED");
    const freezes = await db.membershipFreeze.findMany({ where: { membershipId } });
    expect(remainingUsableMs(membership, freezes, NOW)).toBe(ONE_MONTH_LATER.getTime() - NOW.getTime());
  });

  it("rolls back past an approved freeze in the voided period and cancels the freeze", async () => {
    // Freeze 10-16 Jan falls in the second paid month: approval moves only that period's end.
    const { admin, member, membershipId, second } = await extendedMembership();
    const freeze = await requestFreeze({ userId: member.id, membershipId, firstDay: "2027-01-10", lastDay: "2027-01-16" });
    await approveFreeze({ actorId: admin.id, freezeId: freeze.freezeId });
    expect(await getPayment(second)).toMatchObject({
      periodStart: ONE_MONTH_LATER,
      periodEnd: new Date(TWO_MONTHS_LATER.getTime() + 7 * DAY),
    });

    const result = await voidIt(admin, second);

    expect(result.effect).toMatchObject({ membership: "rolled_back", newEnd: ONE_MONTH_LATER, expired: false });
    expect((await getMembership(membershipId)).currentPeriodEnd).toEqual(ONE_MONTH_LATER);
    expect((await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.freezeId } })).status).toBe("CANCELLED");
    expect(await auditRows("membership_freeze.cancelled")).toEqual([
      expect.objectContaining({ targetId: freeze.freezeId, details: { via: "period_rolled_back" } }),
    ]);
  });

  it("changes only the payment on an ended or lapsed membership", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const member = await createUser();
    const basic = await createPlan();
    const switched = await createManualMembership({ actorId: admin.id, userId: member.id, planId: basic.id, method: "CASH" });
    await createManualMembership({
      actorId: admin.id,
      userId: member.id,
      planId: (await createPlan({ classAccess: "UNLIMITED" })).id,
      method: "CASH",
      confirmSwitch: true,
    });
    const switchedBefore = await getMembership(switched.membershipId);

    const lapsedOwner = await createUser();
    const lapsed = await createManualMembership({ actorId: admin.id, userId: lapsedOwner.id, planId: basic.id, method: "CASH" });
    const later = at(40 * DAY);
    vi.setSystemTime(later);

    const results = [await voidIt(admin, switched.paymentId), await voidIt(admin, lapsed.paymentId)];

    expect(results.map((r) => r.effect)).toEqual([{ membership: "unchanged" }, { membership: "unchanged" }]);
    expect((await getPayment(switched.paymentId)).status).toBe("VOIDED");
    expect((await getPayment(lapsed.paymentId)).status).toBe("VOIDED");
    expect(await getMembership(switched.membershipId)).toEqual(switchedBefore);
    expect(await getMembership(lapsed.membershipId)).toMatchObject({
      status: "EXPIRED",
      currentPeriodEnd: ONE_MONTH_LATER,
      endedAt: ONE_MONTH_LATER,
    });
    expect(await db.auditLog.findFirst({ where: { action: "membership.ended", targetId: lapsed.membershipId } })).toMatchObject({
      actorId: null,
      details: { status: "EXPIRED", via: "overdue_cleanup", trigger: "payment_void" },
    });
    expect(await auditRows("membership.period_rolled_back")).toEqual([]);
  });

  it("frees the method and reference for a new payment", async () => {
    const { admin, membershipId, second } = await extendedMembership();
    await expectMembershipError(
      extendManualMembership({ actorId: admin.id, membershipId, method: "WHISH", reference: "WH-1" }),
      "DUPLICATE_REFERENCE",
    );

    await voidIt(admin, second);
    const again = await extendManualMembership({ actorId: admin.id, membershipId, method: "WHISH", reference: "WH-1" });

    expect(again.newEnd).toEqual(TWO_MONTHS_LATER);
    expect(await db.payment.count({ where: { method: "WHISH", reference: "WH-1" } })).toBe(2);
  });

  it("rejects a non-admin actor, an unknown payment, and a missing or personal reason", async () => {
    const { admin, member, second } = await extendedMembership();
    for (const actor of [member, await createUser({ role: "TRAINER" }), await createUser({ role: "ADMIN", anonymizedAt: NOW })]) {
      await expectMembershipError(voidIt(actor, second), "ACTOR_NOT_ADMIN");
    }
    await expectMembershipError(voidIt(admin, MISSING_ID), "PAYMENT_NOT_FOUND");
    for (const reason of ["", "   ", "Ask someone@example.com", "x".repeat(501)]) {
      await expect(voidIt(admin, second, { reason })).rejects.toBeInstanceOf(ZodError);
    }
    expect((await getPayment(second)).status).toBe("SUCCEEDED");
    expect(await auditRows("payment.voided")).toEqual([]);
  });

  it("voids a payment once under two concurrent voids", async () => {
    const { admin, membershipId, second } = await extendedMembership();
    const otherAdmin = await createUser({ role: "ADMIN" });

    const results = await Promise.allSettled([voidIt(admin, second), voidIt(otherAdmin, second)]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "PAYMENT_NOT_VALID" });
    expect((await getMembership(membershipId)).currentPeriodEnd).toEqual(ONE_MONTH_LATER);
    expect(await auditRows("membership.period_rolled_back")).toHaveLength(1);
  });
});

describe("refundPayment", () => {
  it("records a partial refund on any payment, changing amounts only", async () => {
    const { admin, membershipId, first } = await extendedMembership();
    const later = at(5 * DAY);
    vi.setSystemTime(later);

    const result = await refund(admin, first, 1200, { reason: "  Goodwill for closure  " });

    expect(result).toEqual({ paymentId: first, membershipId, effect: { membership: "unchanged" } });
    expect(await getPayment(first)).toMatchObject({
      status: "PARTIALLY_REFUNDED",
      amountCents: 3000,
      amountRefundedCents: 1200,
      refundedAt: later,
      refundedById: admin.id,
      refundReason: "Goodwill for closure",
    });
    expect(await getMembership(membershipId)).toMatchObject({ status: "ACTIVE", currentPeriodEnd: TWO_MONTHS_LATER });
    expect(await auditRows("payment.refunded")).toEqual([
      expect.objectContaining({
        actorId: admin.id,
        targetType: "payment",
        targetId: first,
        ipHash: "ip",
        createdAt: later,
        details: { membershipId, amountRefundedCents: 1200, full: false },
      }),
    ]);
    expect(await auditRows("membership.period_rolled_back")).toEqual([]);
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain("Goodwill");
  });

  it("rolls back on a full refund of the latest payment, and cancels on a full refund of the activating one", async () => {
    const { admin, membershipId, first, second } = await extendedMembership();

    const rolledBack = await refund(admin, second, 3000);
    expect(rolledBack.effect).toEqual({
      membership: "rolled_back",
      previousEnd: TWO_MONTHS_LATER,
      newEnd: ONE_MONTH_LATER,
      expired: false,
    });
    expect(await getPayment(second)).toMatchObject({ status: "REFUNDED", amountRefundedCents: 3000 });
    expect((await auditRows("payment.refunded"))[0].details).toEqual({ membershipId, amountRefundedCents: 3000, full: true });

    const cancelled = await refund(admin, first, 3000);
    expect(cancelled.effect).toEqual({ membership: "cancelled" });
    expect(await getMembership(membershipId)).toMatchObject({ status: "CANCELLED", endedAt: NOW });
    expect((await auditRows("membership.ended"))[0].details).toEqual({ status: "CANCELLED", via: "refund", paymentId: first });
  });

  it("rejects a full refund of a payment that isn't the latest valid one", async () => {
    const { admin, membershipId, first } = await extendedMembership();

    await expectMembershipError(refund(admin, first, 3000), "NOT_LATEST_PAYMENT");

    expect((await getPayment(first)).status).toBe("SUCCEEDED");
    expect((await getMembership(membershipId)).currentPeriodEnd).toEqual(TWO_MONTHS_LATER);
  });

  it("rejects a second refund and amounts outside 1 cent to the payment amount", async () => {
    const { admin, first, second } = await extendedMembership();
    for (const amount of [0, -100, 3001]) {
      await expectMembershipError(refund(admin, second, amount), "INVALID_AMOUNT");
    }
    await expect(refund(admin, second, 10.5)).rejects.toBeInstanceOf(ZodError);

    await refund(admin, second, 1);
    await expectMembershipError(refund(admin, second, 1), "ALREADY_REFUNDED");
    await refund(admin, first, 500);
    await expectMembershipError(refund(admin, first, 3000), "ALREADY_REFUNDED");

    expect(await getPayment(second)).toMatchObject({ status: "PARTIALLY_REFUNDED", amountRefundedCents: 1 });
    expect(await auditRows("payment.refunded")).toHaveLength(2);
  });

  it("rejects a refund on a voided payment and on Stripe payments", async () => {
    const { admin, second } = await extendedMembership();
    await voidIt(admin, second);
    await expectMembershipError(refund(admin, second, 100), "PAYMENT_NOT_VALID");

    const stripe = await createStripePayment();
    await expectMembershipError(refund(admin, stripe.id, 100), "NOT_MANUAL");
    expect(await getPayment(stripe.id)).toEqual(stripe);
  });

  it("rejects a non-admin actor", async () => {
    const { member, second } = await extendedMembership();
    await expectMembershipError(refund(member, second, 100), "ACTOR_NOT_ADMIN");
    expect((await getPayment(second)).amountRefundedCents).toBe(0);
  });
});
