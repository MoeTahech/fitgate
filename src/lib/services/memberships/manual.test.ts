import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { resetDatabase } from "../../../../tests/support/database";
import {
  createClassPackPlan,
  createCouplesPlan,
  createDayPassPlan,
  createFreeze,
  createGymTrialPlan,
  createManualPayment,
  createMembershipInvite,
  createOwnedMembership,
  createPlan,
  createSeat,
  createUser,
} from "../../../../tests/support/factories";
import { expectMembershipError } from "../../../../tests/support/membership-errors";
import { MembershipError } from "./errors";
import {
  createManualMembership,
  extendManualMembership,
  type CreateManualMembershipInput,
  type ExtendManualMembershipInput,
} from "./manual";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Wednesday 2 December 2026, 10:00 in Beirut (UTC+2). The gym is open 06:00-22:00 every day.
const NOW = new Date("2026-12-02T08:00:00.000Z");
const CLOSING_TODAY = new Date("2026-12-02T20:00:00.000Z");
const ONE_MONTH_LATER = new Date("2027-01-02T08:00:00.000Z");
const MISSING_ID = "0190f2a0-0000-7000-8000-000000000000";

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

async function people() {
  return { admin: await createUser({ role: "ADMIN" }), member: await createUser() };
}

function record(
  admin: { id: string },
  member: { id: string },
  plan: { id: string },
  overrides: Partial<CreateManualMembershipInput> = {},
) {
  return createManualMembership({ actorId: admin.id, userId: member.id, planId: plan.id, method: "CASH", ipHash: "ip", ...overrides });
}

function extend(admin: { id: string }, membershipId: string, overrides: Partial<ExtendManualMembershipInput> = {}) {
  return extendManualMembership({ actorId: admin.id, membershipId, method: "CASH", ipHash: "ip", ...overrides });
}

function openBases(userId: string) {
  return db.membershipMember.findMany({ where: { userId, planType: "BASE", endedAt: null } });
}

function getMembership(id: string) {
  return db.membership.findUniqueOrThrow({ where: { id } });
}

function auditRows(action: string) {
  return db.auditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } });
}

describe("createManualMembership", () => {
  it("creates the membership, owner seat, and payment at the plan's price, and audits without note or reference", async () => {
    const { admin, member } = await people();
    const plan = await createPlan({ priceCents: 3000 });

    const result = await record(admin, member, plan, { method: "WHISH", reference: "  WH-123  ", note: "  Paid at the desk  " });

    expect(result).toEqual({
      membershipId: expect.any(String),
      paymentId: expect.any(String),
      periodStart: NOW,
      periodEnd: ONE_MONTH_LATER,
      replaced: { action: "none" },
    });
    expect(await getMembership(result.membershipId)).toMatchObject({
      ownerId: member.id,
      planId: plan.id,
      source: "MANUAL",
      status: "ACTIVE",
      createdById: admin.id,
      startsAt: NOW,
      currentPeriodStart: NOW,
      currentPeriodEnd: ONE_MONTH_LATER,
      endedAt: null,
      createdAt: NOW,
    });
    expect(await db.membershipMember.findMany({ where: { membershipId: result.membershipId } })).toEqual([
      expect.objectContaining({ userId: member.id, role: "OWNER", planType: "BASE", joinedAt: NOW, endedAt: null }),
    ]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } })).toMatchObject({
      membershipId: result.membershipId,
      userId: member.id,
      method: "WHISH",
      status: "SUCCEEDED",
      amountCents: 3000,
      amountRefundedCents: 0,
      currency: "usd",
      periodStart: NOW,
      periodEnd: ONE_MONTH_LATER,
      paidAt: NOW,
      reference: "WH-123",
      note: "Paid at the desk",
      recordedById: admin.id,
      createdAt: NOW,
    });
    expect(await db.creditLedger.count()).toBe(0);

    const audits = await db.auditLog.findMany({ orderBy: { action: "asc" } });
    expect(audits).toEqual([
      expect.objectContaining({
        action: "membership.created",
        actorId: admin.id,
        targetType: "membership",
        targetId: result.membershipId,
        ipHash: "ip",
        createdAt: NOW,
        details: { via: "manual", planId: plan.id },
      }),
      expect.objectContaining({
        action: "payment.recorded",
        actorId: admin.id,
        targetType: "payment",
        targetId: result.paymentId,
        ipHash: "ip",
        createdAt: NOW,
        details: { membershipId: result.membershipId, method: "WHISH", amountCents: 3000, currency: "usd" },
      }),
    ]);
    const serialized = JSON.stringify(audits);
    for (const secret of ["WH-123", "Paid at the desk", member.email]) expect(serialized).not.toContain(secret);
  });

  it("stores a blank note and reference as null", async () => {
    const { admin, member } = await people();
    const result = await record(admin, member, await createPlan(), { reference: "  ", note: "" });
    expect(await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } })).toMatchObject({ reference: null, note: null });
  });

  it("rejects a note with an email address or a URL, or over 500 characters", async () => {
    const { admin, member } = await people();
    const plan = await createPlan();
    for (const note of ["Receipt sent to someone@example.com", "See https://pay.example/r/1", "Proof on www.example.org", "x".repeat(501)]) {
      await expect(record(admin, member, plan, { note })).rejects.toBeInstanceOf(ZodError);
    }
    expect(await db.membership.count()).toBe(0);
  });

  it("grants a Class Pack's credits for 60 days, alongside an open base", async () => {
    const { admin, member } = await people();
    const base = await createOwnedMembership(member, await createPlan());

    const result = await record(admin, member, await createClassPackPlan());

    expect(result).toMatchObject({ periodEnd: new Date("2027-01-31T08:00:00.000Z"), replaced: { action: "none" } });
    expect(await db.creditLedger.findMany()).toEqual([
      expect.objectContaining({
        membershipId: result.membershipId,
        userId: member.id,
        delta: 10,
        reason: "GRANT",
        actorId: admin.id,
        createdAt: NOW,
      }),
    ]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } })).amountCents).toBe(7000);
    expect((await getMembership(base.id)).status).toBe("ACTIVE");
    expect(await db.membershipMember.count({ where: { userId: member.id, endedAt: null } })).toBe(2);
    expect(await db.membershipMember.findFirstOrThrow({ where: { membershipId: result.membershipId } })).toMatchObject({
      role: "OWNER",
      planType: "ADDON",
    });
  });

  it("closes a lapsed base through overdue cleanup and then creates the new one", async () => {
    const { admin, member } = await people();
    const plan = await createPlan();
    const lapsed = await createOwnedMembership(member, plan, { startsAt: at(-31 * DAY), currentPeriodEnd: at(-DAY) });

    const result = await record(admin, member, plan);

    expect(result.replaced).toEqual({ action: "none" });
    expect(await getMembership(lapsed.id)).toMatchObject({ status: "EXPIRED", endedAt: lapsed.currentPeriodEnd });
    expect((await openBases(member.id)).map((seat) => seat.membershipId)).toEqual([result.membershipId]);
    expect(await auditRows("membership.ended")).toEqual([
      expect.objectContaining({
        actorId: null,
        targetId: lapsed.id,
        details: { status: "EXPIRED", via: "overdue_cleanup", trigger: "manual_create" },
      }),
    ]);
  });

  it("rejects inactive, trial, and unknown plans, and the STRIPE method", async () => {
    const { admin, member } = await people();
    for (const plan of [await createPlan({ active: false }), await createGymTrialPlan(), { id: MISSING_ID }]) {
      await expectMembershipError(record(admin, member, plan), "PLAN_UNAVAILABLE");
    }
    const stripe = { method: "STRIPE" } as unknown as Partial<CreateManualMembershipInput>;
    await expect(record(admin, member, await createPlan(), stripe)).rejects.toBeInstanceOf(ZodError);

    expect(await db.membership.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
  });

  it("rejects a non-admin or anonymized actor, and an anonymized or unknown member", async () => {
    const { admin, member } = await people();
    const plan = await createPlan();
    const actors = [
      await createUser({ role: "TRAINER" }),
      await createUser(),
      await createUser({ role: "ADMIN", anonymizedAt: NOW }),
      member,
    ];
    for (const actor of actors) {
      await expectMembershipError(record(actor, member, plan), "ACTOR_NOT_ADMIN");
    }
    await expectMembershipError(record(admin, await createUser({ anonymizedAt: NOW }), plan), "USER_ANONYMIZED");
    await expectMembershipError(record(admin, { id: "missing-user" }, plan), "USER_NOT_FOUND");
    expect(await db.membership.count()).toBe(0);
  });

  it("ends a Day Pass at today's closing time, which later opening-hour changes don't move", async () => {
    const { admin, member } = await people();

    const result = await record(admin, member, await createDayPassPlan());
    expect(result).toMatchObject({ periodStart: NOW, periodEnd: CLOSING_TODAY });

    await db.openingHours.updateMany({ data: { closesAtMin: 1380 } });
    expect((await getMembership(result.membershipId)).currentPeriodEnd).toEqual(CLOSING_TODAY);
  });

  it("rejects a Day Pass at or after closing time and on a closed day", async () => {
    const { admin, member } = await people();
    const dayPass = await createDayPassPlan();

    for (const now of [CLOSING_TODAY, new Date(CLOSING_TODAY.getTime() + 1)]) {
      vi.setSystemTime(now);
      await expectMembershipError(record(admin, member, dayPass), "CLOSED_FOR_TODAY");
    }

    await db.openingHours.delete({ where: { weekday: 4 } });
    vi.setSystemTime(new Date("2026-12-03T08:00:00.000Z"));
    await expectMembershipError(record(admin, member, dayPass), "CLOSED_FOR_TODAY");

    expect(await db.membership.count()).toBe(0);
  });
});

describe("createManualMembership replacing an open base", () => {
  it("supersedes a Gym Trial with a recurring plan, keeping the trial redemption", async () => {
    const { admin, member } = await people();
    const trial = await createOwnedMembership(member, await createGymTrialPlan(), { source: "TRIAL", currentPeriodEnd: CLOSING_TODAY });
    const redemption = await db.trialRedemption.create({
      data: { userId: member.id, membershipId: trial.id, kind: "GYM", emailHash: "email-hash", createdAt: NOW },
    });
    const basic = await createPlan();

    const result = await record(admin, member, basic);

    expect(result.replaced).toEqual({ action: "superseded", membershipId: trial.id });
    expect(await getMembership(trial.id)).toMatchObject({ status: "CANCELLED", endedAt: NOW });
    expect((await openBases(member.id)).map((seat) => seat.membershipId)).toEqual([result.membershipId]);
    expect(await auditRows("membership.ended")).toEqual([
      expect.objectContaining({ actorId: admin.id, targetId: trial.id, details: { status: "CANCELLED", via: "superseded" } }),
    ]);
    expect((await auditRows("membership.created"))[0].details).toEqual({
      via: "manual",
      planId: basic.id,
      replacedMembershipId: trial.id,
      replaced: "superseded",
    });
    expect(await db.trialRedemption.findUniqueOrThrow({ where: { id: redemption.id } })).toEqual(redemption);
  });

  it("supersedes a Day Pass with a recurring plan, but rejects a Day Pass on an open Day Pass or Gym Trial", async () => {
    const { admin, member } = await people();
    const dayPass = await createDayPassPlan();
    const pass = await createOwnedMembership(member, dayPass, { currentPeriodEnd: CLOSING_TODAY });

    const result = await record(admin, member, await createPlan());
    expect(result.replaced).toEqual({ action: "superseded", membershipId: pass.id });
    expect((await getMembership(pass.id)).status).toBe("CANCELLED");

    const passHolder = await createUser();
    const trialHolder = await createUser();
    await createOwnedMembership(passHolder, dayPass, { currentPeriodEnd: CLOSING_TODAY });
    await createOwnedMembership(trialHolder, await createGymTrialPlan(), { source: "TRIAL", currentPeriodEnd: CLOSING_TODAY });
    for (const holder of [passHolder, trialHolder]) {
      const error = await expectMembershipError(record(admin, holder, dayPass, { confirmSwitch: true }), "HAS_ACTIVE_BASE");
      expect(error.details).toEqual({ reason: "DAY_PASS_OR_TRIAL" });
      expect(await openBases(holder.id)).toHaveLength(1);
    }
  });

  it("asks to confirm a switch with the days left, and changes nothing without confirmation", async () => {
    const { admin, member } = await people();
    const open = await createOwnedMembership(member, await createPlan(), {
      startsAt: at(-10 * DAY),
      currentPeriodEnd: at(20 * DAY - HOUR),
    });

    const error = await expectMembershipError(record(admin, member, await createPlan({ classAccess: "UNLIMITED" })), "HAS_ACTIVE_BASE");

    expect(error.details).toEqual({ reason: "SWITCH_NEEDS_CONFIRMATION", remainingDays: 20, hasPartner: false });
    expect((await getMembership(open.id)).status).toBe("ACTIVE");
    expect(await db.membership.count()).toBe(1);
    expect(await db.payment.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("switches with confirmation: the old membership ends now and keeps its payments", async () => {
    const { admin, member } = await people();
    const basic = await createPlan();
    const premium = await createPlan({ classAccess: "UNLIMITED", priceCents: 5000 });
    const open = await createOwnedMembership(member, basic, { startsAt: at(-10 * DAY) });
    const payment = await createManualPayment(open, admin.id);

    const result = await record(admin, member, premium, { confirmSwitch: true });

    expect(result.replaced).toEqual({ action: "switched", membershipId: open.id });
    expect(await getMembership(open.id)).toMatchObject({ status: "CANCELLED", endedAt: NOW });
    expect(await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(payment);
    expect(await getMembership(result.membershipId)).toMatchObject({ planId: premium.id, currentPeriodEnd: ONE_MONTH_LATER });
    expect((await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } })).amountCents).toBe(5000);
    expect((await openBases(member.id)).map((seat) => seat.membershipId)).toEqual([result.membershipId]);
    expect(await auditRows("membership.ended")).toEqual([
      expect.objectContaining({
        actorId: admin.id,
        targetId: open.id,
        details: { status: "CANCELLED", via: "switched", fromPlanId: basic.id, toPlanId: premium.id },
      }),
    ]);
  });

  it("reports the partner on a Couples switch, and removes the partner and the pending invite with confirmation", async () => {
    const { admin, member } = await people();
    const partner = await createUser();
    const open = await createOwnedMembership(member, await createCouplesPlan(), { startsAt: at(-DAY) });
    await createSeat(open.id, partner.id, { role: "PARTNER", joinedAt: open.startsAt });
    const invite = await createMembershipInvite(open.id, member.id, { createdAt: at(-HOUR) });
    const basic = await createPlan();

    const error = await expectMembershipError(record(admin, member, basic), "HAS_ACTIVE_BASE");
    expect(error.details).toEqual({ reason: "SWITCH_NEEDS_CONFIRMATION", remainingDays: 29, hasPartner: true });

    await record(admin, member, basic, { confirmSwitch: true });

    expect(await openBases(partner.id)).toEqual([]);
    expect(await db.membershipMember.findFirstOrThrow({ where: { userId: partner.id } })).toMatchObject({ endedAt: NOW });
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({
      status: "REVOKED",
      revokedAt: NOW,
      revokedById: null,
    });
  });

  it("excludes the days of an approved future freeze and cancels it, and cancels a requested freeze", async () => {
    const { admin, member } = await people();
    const premium = await createPlan({ classAccess: "UNLIMITED" });
    const open = await createOwnedMembership(member, await createPlan(), {
      startsAt: at(-10 * DAY),
      currentPeriodEnd: at(20 * DAY - HOUR),
    });
    const approved = await createFreeze(open.id, member.id, {
      status: "APPROVED",
      startsAt: at(5 * DAY),
      endsAt: at(12 * DAY),
      decidedById: admin.id,
    });

    const error = await expectMembershipError(record(admin, member, premium), "HAS_ACTIVE_BASE");
    expect(error.details).toEqual({ reason: "SWITCH_NEEDS_CONFIRMATION", remainingDays: 13, hasPartner: false });
    await record(admin, member, premium, { confirmSwitch: true });
    expect((await db.membershipFreeze.findUniqueOrThrow({ where: { id: approved.id } })).status).toBe("CANCELLED");

    const other = await createUser();
    const otherOpen = await createOwnedMembership(other, await createPlan(), { startsAt: at(-DAY) });
    const requested = await createFreeze(otherOpen.id, other.id, { startsAt: at(3 * DAY) });
    await record(admin, other, premium, { confirmSwitch: true });
    expect((await db.membershipFreeze.findUniqueOrThrow({ where: { id: requested.id } })).status).toBe("CANCELLED");
  });

  it("rejects the same plan with SAME_PLAN", async () => {
    const { admin, member } = await people();
    const plan = await createPlan();
    const open = await createOwnedMembership(member, plan);

    await expectMembershipError(record(admin, member, plan, { confirmSwitch: true }), "SAME_PLAN");
    expect((await getMembership(open.id)).status).toBe("ACTIVE");
  });

  it("rejects switching a recurring base to a one-time base plan, even with confirmation", async () => {
    const { admin, member } = await people();
    const open = await createOwnedMembership(member, await createPlan(), { startsAt: at(-DAY) });
    const oneTimeBase = await createPlan({ billing: "ONE_TIME", intervalMonths: null, durationDays: 30, durationMode: "ROLLING" });

    for (const plan of [await createDayPassPlan(), oneTimeBase]) {
      for (const confirmSwitch of [false, true]) {
        const error = await expectMembershipError(record(admin, member, plan, { confirmSwitch }), "HAS_ACTIVE_BASE");
        expect(error.details).toEqual({ reason: "SWITCH_TARGET_NOT_RECURRING" });
      }
    }

    expect((await getMembership(open.id)).status).toBe("ACTIVE");
    expect(await db.membership.count()).toBe(1);
    expect(await db.payment.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("rejects a Couples partner without touching the owner's membership", async () => {
    const { admin, member } = await people();
    const owner = await createUser();
    const shared = await createOwnedMembership(owner, await createCouplesPlan());
    await createSeat(shared.id, member.id, { role: "PARTNER" });

    const error = await expectMembershipError(record(admin, member, await createPlan(), { confirmSwitch: true }), "HAS_ACTIVE_BASE");

    expect(error.details).toEqual({ reason: "PARTNER_SEAT" });
    expect((await getMembership(shared.id)).status).toBe("ACTIVE");
    expect(await db.membershipMember.count({ where: { membershipId: shared.id, endedAt: null } })).toBe(2);
  });

  it("ends nothing when the new plan fails with CLOSED_FOR_TODAY", async () => {
    const { admin, member } = await people();
    const open = await createOwnedMembership(member, await createPlan(), { startsAt: at(-DAY) });
    const lapsed = await createOwnedMembership(member, await createClassPackPlan(), {
      startsAt: at(-61 * DAY),
      currentPeriodEnd: at(-DAY),
    });
    vi.setSystemTime(at(13 * HOUR));

    await expectMembershipError(record(admin, member, await createDayPassPlan(), { confirmSwitch: true }), "CLOSED_FOR_TODAY");

    expect((await getMembership(open.id)).status).toBe("ACTIVE");
    expect((await getMembership(lapsed.id)).status).toBe("ACTIVE");
    expect(await db.auditLog.count()).toBe(0);
  });

  it("leaves exactly one base after two concurrent creates", async () => {
    const { admin, member } = await people();
    const plan = await createPlan();

    const results = await Promise.allSettled([record(admin, member, plan), record(admin, member, plan)]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "SAME_PLAN" });
    expect(await openBases(member.id)).toHaveLength(1);
    expect(await db.membership.count()).toBe(1);
    expect(await db.payment.count()).toBe(1);
  });

  it("leaves exactly one base after two concurrent switches", async () => {
    const { admin, member } = await people();
    const open = await createOwnedMembership(member, await createPlan(), { startsAt: at(-DAY) });
    const premium = await createPlan({ classAccess: "UNLIMITED" });

    const results = await Promise.allSettled([
      record(admin, member, premium, { confirmSwitch: true }),
      record(admin, member, premium, { confirmSwitch: true }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await getMembership(open.id)).status).toBe("CANCELLED");
    const bases = await openBases(member.id);
    expect(bases).toHaveLength(1);
    expect((await getMembership(bases[0].membershipId)).planId).toBe(premium.id);
    expect(await auditRows("membership.ended")).toHaveLength(1);
  });

  it("rejects a duplicate method and reference, and allows it again after a void", async () => {
    const { admin, member } = await people();
    const other = await createUser();
    const pack = await createClassPackPlan();
    const first = await record(admin, member, pack, { method: "OMT", reference: "OMT-1" });

    await expectMembershipError(record(admin, other, pack, { method: "OMT", reference: "OMT-1" }), "DUPLICATE_REFERENCE");
    await expect(record(admin, other, pack, { method: "WHISH", reference: "OMT-1" })).resolves.toBeDefined();

    await db.payment.update({
      where: { id: first.paymentId },
      data: { status: "VOIDED", voidedAt: NOW, voidedById: admin.id, voidReason: "Recorded twice" },
    });
    await expect(record(admin, other, pack, { method: "OMT", reference: "OMT-1" })).resolves.toBeDefined();
    expect(await db.payment.count({ where: { method: "OMT", reference: "OMT-1" } })).toBe(2);
  });

  it("maps a concurrent duplicate reference that passed the pre-check to DUPLICATE_REFERENCE", async () => {
    const pack = await createClassPackPlan();
    const [adminA, adminB, memberA, memberB] = await Promise.all([
      createUser({ role: "ADMIN" }),
      createUser({ role: "ADMIN" }),
      createUser(),
      createUser(),
    ]);

    const results = await Promise.allSettled([
      record(adminA, memberA, pack, { reference: "CASH-7" }),
      record(adminB, memberB, pack, { reference: "CASH-7" }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(MembershipError);
    expect(rejected?.reason).toMatchObject({ code: "DUPLICATE_REFERENCE" });
    expect(await db.membership.count()).toBe(1);
  });
});

describe("extendManualMembership", () => {
  it("extends from the current end at the plan's current price, keeping the period start", async () => {
    const { admin, member } = await people();
    const plan = await createPlan({ intervalMonths: 3, priceCents: 8100 });
    const created = await record(admin, member, plan);
    const previousEnd = new Date("2027-03-02T08:00:00.000Z");
    expect(created.periodEnd).toEqual(previousEnd);

    const later = at(40 * DAY);
    vi.setSystemTime(later);
    await db.plan.update({ where: { id: plan.id }, data: { priceCents: 9000, active: false } });

    const result = await extend(admin, created.membershipId, { method: "BANK_TRANSFER", reference: "BT-9", note: "Second quarter" });

    // 10:00 in Beirut, which is on summer time (UTC+3) by June.
    const newEnd = new Date("2027-06-02T07:00:00.000Z");
    expect(result).toEqual({ membershipId: created.membershipId, paymentId: expect.any(String), previousEnd, newEnd });
    expect(await getMembership(created.membershipId)).toMatchObject({
      startsAt: NOW,
      currentPeriodStart: NOW,
      currentPeriodEnd: newEnd,
      status: "ACTIVE",
    });
    expect(await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } })).toMatchObject({
      membershipId: created.membershipId,
      userId: member.id,
      method: "BANK_TRANSFER",
      status: "SUCCEEDED",
      amountCents: 9000,
      periodStart: previousEnd,
      periodEnd: newEnd,
      paidAt: later,
      reference: "BT-9",
      note: "Second quarter",
      recordedById: admin.id,
      createdAt: later,
    });

    const [extended] = await auditRows("membership.extended");
    expect(extended).toMatchObject({
      actorId: admin.id,
      targetId: created.membershipId,
      ipHash: "ip",
      createdAt: later,
      details: { paymentId: result.paymentId, previousEnd: previousEnd.toISOString(), newEnd: newEnd.toISOString() },
    });
    const recorded = await auditRows("payment.recorded");
    expect(recorded.map((row) => row.targetId)).toEqual([created.paymentId, result.paymentId]);
    const serialized = JSON.stringify(await db.auditLog.findMany());
    for (const secret of ["BT-9", "Second quarter"]) expect(serialized).not.toContain(secret);
  });

  it("rejects one-time plans, trials, and Stripe memberships with NOT_EXTENDABLE", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const [dayPassHolder, packHolder, trialHolder, stripeHolder] = await Promise.all([createUser(), createUser(), createUser(), createUser()]);
    const memberships = [
      await createOwnedMembership(dayPassHolder, await createDayPassPlan(), { currentPeriodEnd: CLOSING_TODAY }),
      await createOwnedMembership(packHolder, await createClassPackPlan()),
      await createOwnedMembership(trialHolder, await createGymTrialPlan(), { source: "TRIAL", currentPeriodEnd: CLOSING_TODAY }),
      await createOwnedMembership(stripeHolder, await createPlan(), { source: "STRIPE" }),
    ];

    for (const membership of memberships) {
      await expectMembershipError(extend(admin, membership.id), "NOT_EXTENDABLE");
      expect((await getMembership(membership.id)).currentPeriodEnd).toEqual(membership.currentPeriodEnd);
    }
    expect(await db.payment.count()).toBe(0);
  });

  it("rejects a lapsed or ended membership with MEMBERSHIP_ENDED", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const plan = await createPlan();
    const lapsed = await createOwnedMembership(await createUser(), plan, { startsAt: at(-30 * DAY), currentPeriodEnd: NOW });
    const cancelled = await createOwnedMembership(await createUser(), plan, { status: "CANCELLED", startsAt: at(-10 * DAY) });

    for (const membership of [lapsed, cancelled]) {
      await expectMembershipError(extend(admin, membership.id), "MEMBERSHIP_ENDED");
      expect((await getMembership(membership.id)).currentPeriodEnd).toEqual(membership.currentPeriodEnd);
    }
    expect(await db.payment.count()).toBe(0);
  });

  it("rejects a non-admin actor, an unknown membership, and a duplicate reference", async () => {
    const { admin, member } = await people();
    const created = await record(admin, member, await createPlan(), { reference: "CASH-1" });

    await expectMembershipError(extend(member, created.membershipId), "ACTOR_NOT_ADMIN");
    await expectMembershipError(extend(admin, MISSING_ID), "MEMBERSHIP_NOT_FOUND");
    await expectMembershipError(extend(admin, created.membershipId, { reference: "CASH-1" }), "DUPLICATE_REFERENCE");
    expect(await db.payment.count()).toBe(1);
  });
});
