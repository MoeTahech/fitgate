import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/memberships-ui/forms";
import { AUTH_ERROR_MESSAGES, membershipErrorResult } from "@/lib/memberships-ui/messages";
import { formatMoney } from "@/lib/money";
import { createManualMembership, extendManualMembership } from "@/lib/services/memberships/manual";
import { resetDatabase } from "../../../../tests/support/database";
import {
  createClassPackPlan,
  createCouplesPlan,
  createFreeze,
  createMembershipInvite,
  createOwnedMembership,
  createPlan,
  createSeat,
  createUser,
} from "../../../../tests/support/factories";
import {
  adminRemovePartnerAction,
  adminRevokeInviteAction,
  approveFreezeAction,
  cancelFreezeAction,
  extendMembershipAction,
  refundPaymentAction,
  rejectFreezeAction,
  voidPaymentAction,
} from "./actions";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
const request = vi.hoisted(() => ({ ip: null as string | null }));
const cache = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/lib/auth/session", async () => {
  const guards = await import("@/lib/auth/guards");
  return { ...guards, ...guards.createGuards(async () => session.user) };
});

vi.mock("next/cache", () => ({ refresh: cache.refresh }));

vi.mock("@/lib/request-ip", () => ({
  getRequestIp: async () => request.ip,
  getRequestIpHash: async () => (request.ip ? `hash:${request.ip}` : null),
}));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Wednesday 2 December 2026, 10:00 in Beirut (UTC+2). The gym is open 06:00-22:00 every day.
const NOW = new Date("2026-12-02T08:00:00.000Z");
// The current end, 25 days ahead (27 December, 10:00), and one month later (27 January, 10:00).
const CURRENT_END = new Date("2026-12-27T08:00:00.000Z");
const NEXT_END = new Date("2027-01-27T08:00:00.000Z");
const IDLE: ActionResult = { status: "idle" };

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  request.ip = `test-ip-${randomUUID()}`;
  await resetDatabase();
  await db.gymSettings.create({ data: { id: 1, name: "Gym", timeZone: "Asia/Beirut", capacity: 50 } });
  await db.openingHours.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAtMin: 360, closesAtMin: 1320 })),
  });
});

afterEach(() => {
  session.user = null;
  vi.clearAllMocks();
  vi.useRealTimers();
});

function signInAs(user: { id: string; name: string; email: string; role: Role }) {
  session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function signedInAdmin() {
  const admin = await createUser({ role: "ADMIN" });
  signInAs(admin);
  return admin;
}

async function basic(overrides: { currentPeriodEnd?: Date } = {}) {
  const owner = await createUser();
  const plan = await createPlan({ name: "Basic", priceCents: 3000 });
  const membership = await createOwnedMembership(owner, plan, {
    startsAt: at(-5 * DAY),
    currentPeriodEnd: overrides.currentPeriodEnd ?? CURRENT_END,
  });
  return { owner, plan, membership };
}

describe("extendMembershipAction", () => {
  it("records the plan's price for the next period and moves the end by one month", async () => {
    const admin = await signedInAdmin();
    const { owner, membership } = await basic();

    const result = await extendMembershipAction(
      IDLE,
      form({ membershipId: membership.id, method: "OMT", reference: "OMT-7", note: "" }),
    );

    expect(result).toEqual({ status: "success", message: expect.stringContaining("extended") });
    expect(await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({ currentPeriodEnd: NEXT_END });
    expect(await db.payment.findFirstOrThrow({ where: { membershipId: membership.id } })).toMatchObject({
      userId: owner.id,
      amountCents: 3000,
      method: "OMT",
      reference: "OMT-7",
      note: null,
      periodStart: CURRENT_END,
      periodEnd: NEXT_END,
      recordedById: admin.id,
    });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("explains a membership whose period is over and records nothing", async () => {
    await signedInAdmin();
    const { membership } = await basic({ currentPeriodEnd: at(-DAY) });

    await expect(extendMembershipAction(IDLE, form({ membershipId: membership.id, method: "CASH" }))).resolves.toEqual(
      membershipErrorResult({ code: "MEMBERSHIP_ENDED" }, "admin"),
    );
    expect(await db.payment.count()).toBe(0);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it("explains a one-time plan that can't be extended", async () => {
    await signedInAdmin();
    const owner = await createUser();
    const pack = await createClassPackPlan();
    const membership = await createOwnedMembership(owner, pack, { startsAt: at(-DAY), currentPeriodEnd: at(59 * DAY) });

    await expect(extendMembershipAction(IDLE, form({ membershipId: membership.id, method: "CASH" }))).resolves.toEqual(
      membershipErrorResult({ code: "NOT_EXTENDABLE" }, "admin"),
    );
  });

  it("reports a missing method on its field", async () => {
    await signedInAdmin();
    const { membership } = await basic();

    await expect(extendMembershipAction(IDLE, form({ membershipId: membership.id, method: "" }))).resolves.toEqual({
      status: "error",
      fieldErrors: { method: "Choose a payment method" },
    });
  });

  it.each<Role>(["MEMBER", "TRAINER"])("refuses a %s and leaves the membership as it is", async (role) => {
    signInAs(await createUser({ role }));
    const { membership } = await basic();

    await expect(extendMembershipAction(IDLE, form({ membershipId: membership.id, method: "CASH" }))).resolves.toEqual({
      status: "error",
      message: AUTH_ERROR_MESSAGES.FORBIDDEN,
    });
    expect(await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({ currentPeriodEnd: CURRENT_END });
    expect(await db.payment.count()).toBe(0);
    expect(cache.refresh).not.toHaveBeenCalled();
  });
});

// ─── Corrections, freezes, seats, and invites ───────────────────────────────

// Local midnights of Friday 4 December and Friday 11 December: a 7-day freeze from 4 December.
const DEC_4 = new Date("2026-12-03T22:00:00.000Z");
const DEC_11 = new Date("2026-12-10T22:00:00.000Z");
// The front-desk membership recorded at NOW runs one month, to 2 January 10:00.
const JAN_2 = new Date("2027-01-02T08:00:00.000Z");
const MISSING_ID = "0190f2a0-0000-7000-8000-000000000000";

const REFERENCE = "REF-SECRET-1";
const NOTE = "Front desk note text";
const INVITE_EMAIL = "partner-invite@example.test";

/**
 * A Couples membership recorded at the front desk now (reference and note on its payment), with a
 * partner seat, a pending invite, and a freeze requested for 4-10 December. The admin is signed in.
 */
async function recorded() {
  const admin = await signedInAdmin();
  const owner = await createUser({ name: "Sam Owner" });
  const plan = await createCouplesPlan({ name: "Couples Basic", priceCents: 5000 });
  const { membershipId, paymentId } = await createManualMembership({
    actorId: admin.id,
    userId: owner.id,
    planId: plan.id,
    method: "CASH",
    reference: REFERENCE,
    note: NOTE,
  });
  const partner = await createUser({ name: "Alex Partner" });
  const seat = await createSeat(membershipId, partner.id, { role: "PARTNER", joinedAt: NOW });
  const invite = await createMembershipInvite(membershipId, owner.id, { email: INVITE_EMAIL });
  const freeze = await createFreeze(membershipId, owner.id, { startsAt: DEC_4, endsAt: DEC_11 });
  return { admin, owner, plan, membershipId, paymentId, seat, invite, freeze };
}

/** Every audit row's details, as one string to search. */
async function auditDetails(): Promise<string> {
  const rows = await db.auditLog.findMany({ select: { details: true } });
  return JSON.stringify(rows.map((row) => row.details));
}

const adminError = (code: Parameters<typeof membershipErrorResult>[0]["code"]) => membershipErrorResult({ code }, "admin");

describe("voidPaymentAction", () => {
  it("needs a reason, then stores the trimmed reason and cancels the membership it activated", async () => {
    const { admin, membershipId, paymentId } = await recorded();

    await expect(voidPaymentAction(IDLE, form({ paymentId, reason: "   " }))).resolves.toEqual({
      status: "error",
      fieldErrors: { reason: "Enter a reason" },
    });
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ status: "SUCCEEDED" });
    expect(cache.refresh).not.toHaveBeenCalled();

    const result = await voidPaymentAction(IDLE, form({ paymentId, reason: "  Recorded twice  " }));

    expect(result).toEqual({ status: "success", message: "Payment voided. The membership is cancelled." });
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({
      status: "VOIDED",
      voidReason: "Recorded twice",
      voidedById: admin.id,
      voidedAt: NOW,
    });
    expect(await db.membership.findUniqueOrThrow({ where: { id: membershipId } })).toMatchObject({ status: "CANCELLED" });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("rolls the end back when voiding an extension", async () => {
    const { admin, membershipId } = await recorded();
    const { paymentId: extensionId } = await extendManualMembership({ actorId: admin.id, membershipId, method: "CASH" });

    const result = await voidPaymentAction(IDLE, form({ paymentId: extensionId, reason: "Wrong member" }));

    expect(result).toEqual({ status: "success", message: "Payment voided. The membership's end moved back." });
    expect(await db.membership.findUniqueOrThrow({ where: { id: membershipId } })).toMatchObject({
      status: "ACTIVE",
      currentPeriodEnd: JAN_2,
    });
  });

  it("refuses a payment that isn't the membership's latest, and refreshes the page", async () => {
    const { admin, membershipId, paymentId } = await recorded();
    await extendManualMembership({ actorId: admin.id, membershipId, method: "CASH" });

    await expect(voidPaymentAction(IDLE, form({ paymentId, reason: "Recorded twice" }))).resolves.toEqual(
      adminError("NOT_LATEST_PAYMENT"),
    );
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ status: "SUCCEEDED", voidReason: null });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("explains a payment that no longer exists", async () => {
    await signedInAdmin();

    await expect(voidPaymentAction(IDLE, form({ paymentId: MISSING_ID, reason: "Recorded twice" }))).resolves.toEqual(
      adminError("PAYMENT_NOT_FOUND"),
    );
  });
});

describe("refundPaymentAction", () => {
  it("records 12.50 as 1250 cents with the reason, and leaves the membership as it is", async () => {
    const { admin, membershipId, paymentId } = await recorded();

    const result = await refundPaymentAction(IDLE, form({ paymentId, amount: "12.50", reason: " Goodwill " }));

    expect(result).toEqual({
      status: "success",
      message: `Refund of ${formatMoney(1250, "usd")} recorded. The membership stays as it is.`,
    });
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({
      status: "PARTIALLY_REFUNDED",
      amountRefundedCents: 1250,
      refundReason: "Goodwill",
      refundedById: admin.id,
    });
    expect(await db.membership.findUniqueOrThrow({ where: { id: membershipId } })).toMatchObject({ status: "ACTIVE", currentPeriodEnd: JAN_2 });
  });

  it("refunds the latest payment in full, which withdraws its period like a void", async () => {
    const { membershipId, paymentId } = await recorded();

    const result = await refundPaymentAction(IDLE, form({ paymentId, amount: "50", reason: "Changed their mind" }));

    expect(result).toEqual({ status: "success", message: expect.stringContaining("The membership is cancelled.") });
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ status: "REFUNDED", amountRefundedCents: 5000 });
    expect(await db.membership.findUniqueOrThrow({ where: { id: membershipId } })).toMatchObject({ status: "CANCELLED" });
  });

  it.each([
    ["more than the payment", "50.01"],
    ["three decimals", "12.345"],
    ["text", "twelve"],
    ["zero", "0"],
    ["a negative amount", "-5"],
    ["nothing", ""],
  ])("reports %s on the amount field and records nothing", async (_case, amount) => {
    const { paymentId } = await recorded();

    const result = await refundPaymentAction(IDLE, form({ paymentId, amount, reason: "Goodwill" }));

    expect(result.status).toBe("error");
    expect(result.message).toBeUndefined();
    expect(result.fieldErrors?.amount).toEqual(expect.any(String));
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ status: "SUCCEEDED", amountRefundedCents: 0 });
  });

  it("needs a reason", async () => {
    const { paymentId } = await recorded();

    await expect(refundPaymentAction(IDLE, form({ paymentId, amount: "10", reason: "" }))).resolves.toEqual({
      status: "error",
      fieldErrors: { reason: "Enter a reason" },
    });
  });

  it("parses the amount in the payment's currency, never one sent with the form", async () => {
    const { paymentId } = await recorded();
    await db.payment.update({ where: { id: paymentId }, data: { currency: "jpy" } });

    const decimals = await refundPaymentAction(IDLE, form({ paymentId, amount: "12.50", currency: "usd", reason: "Goodwill" }));
    expect(decimals.fieldErrors?.amount).toBe("Enter an amount like 1250");

    await refundPaymentAction(IDLE, form({ paymentId, amount: "1250", currency: "usd", reason: "Goodwill" }));
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ amountRefundedCents: 1250, currency: "jpy" });
  });

  it("explains a payment that no longer exists", async () => {
    await signedInAdmin();

    await expect(refundPaymentAction(IDLE, form({ paymentId: MISSING_ID, amount: "10", reason: "Goodwill" }))).resolves.toEqual(
      adminError("PAYMENT_NOT_FOUND"),
    );
  });
});

describe("freeze decisions", () => {
  it("approves a request, which moves the end later by the freeze length", async () => {
    const { admin, membershipId, freeze } = await recorded();

    const result = await approveFreezeAction(IDLE, form({ freezeId: freeze.id }));

    expect(result).toEqual({ status: "success", message: expect.stringContaining("Freeze approved.") });
    expect(await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id } })).toMatchObject({
      status: "APPROVED",
      decidedById: admin.id,
      decidedAt: NOW,
    });
    expect(await db.membership.findUniqueOrThrow({ where: { id: membershipId } })).toMatchObject({
      currentPeriodEnd: new Date(JAN_2.getTime() + 7 * DAY),
    });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("explains that a freeze which has started can no longer be approved", async () => {
    const { freeze } = await recorded();
    vi.setSystemTime(new Date(DEC_4.getTime() + HOUR));

    await expect(approveFreezeAction(IDLE, form({ freezeId: freeze.id }))).resolves.toEqual(adminError("FREEZE_STARTED"));
    expect(await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id } })).toMatchObject({ status: "REQUESTED" });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("rejects with the trimmed optional reason", async () => {
    const { admin, membershipId, freeze } = await recorded();

    const result = await rejectFreezeAction(IDLE, form({ freezeId: freeze.id, reason: "  Peak season  " }));

    expect(result).toEqual({ status: "success", message: expect.stringContaining("Freeze rejected.") });
    expect(await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id } })).toMatchObject({
      status: "REJECTED",
      reason: "Peak season",
      decidedById: admin.id,
    });
    expect(await db.membership.findUniqueOrThrow({ where: { id: membershipId } })).toMatchObject({ currentPeriodEnd: JAN_2 });
  });

  it("rejects without a reason, storing none", async () => {
    const { freeze } = await recorded();

    await rejectFreezeAction(IDLE, form({ freezeId: freeze.id, reason: "   " }));

    expect(await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id } })).toMatchObject({ status: "REJECTED", reason: null });
  });

  it("reports a rejection reason with a link on the reason field", async () => {
    const { freeze } = await recorded();

    const result = await rejectFreezeAction(IDLE, form({ freezeId: freeze.id, reason: "See www.example.com" }));

    expect(result).toEqual({ status: "error", fieldErrors: { reason: expect.stringContaining("links") } });
    expect(await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id } })).toMatchObject({ status: "REQUESTED" });
  });

  it("cancels an approved freeze, which moves the end back", async () => {
    const { membershipId, freeze } = await recorded();
    await approveFreezeAction(IDLE, form({ freezeId: freeze.id }));

    const result = await cancelFreezeAction(IDLE, form({ freezeId: freeze.id }));

    expect(result).toEqual({ status: "success", message: "Freeze cancelled. The membership's end moved back." });
    expect(await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await db.membership.findUniqueOrThrow({ where: { id: membershipId } })).toMatchObject({ currentPeriodEnd: JAN_2 });
  });
});

describe("adminRemovePartnerAction and adminRevokeInviteAction", () => {
  it("removes the partner, ending the seat now", async () => {
    const { seat } = await recorded();

    await expect(adminRemovePartnerAction(IDLE, form({ seatId: seat.id }))).resolves.toEqual({
      status: "success",
      message: expect.stringContaining("Partner removed."),
    });
    expect(await db.membershipMember.findUniqueOrThrow({ where: { id: seat.id } })).toMatchObject({ endedAt: NOW });
  });

  it("revokes a pending invite", async () => {
    const { admin, invite } = await recorded();

    await expect(adminRevokeInviteAction(IDLE, form({ inviteId: invite.id }))).resolves.toEqual({
      status: "success",
      message: expect.stringContaining("Invite revoked."),
    });
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({
      status: "REVOKED",
      revokedById: admin.id,
    });
  });

  it("asks to reload when the seat id is stale", async () => {
    await signedInAdmin();

    await expect(adminRemovePartnerAction(IDLE, form({ seatId: "not-an-id" }))).resolves.toEqual({
      status: "error",
      message: expect.stringContaining("Reload the page"),
    });
  });
});

describe("audit details", () => {
  it("never hold reasons, notes, references, or emails", async () => {
    const { admin, membershipId, paymentId, freeze, invite, seat } = await recorded();
    await refundPaymentAction(IDLE, form({ paymentId, amount: "5", reason: "Refund reason text" }));
    const { paymentId: extensionId } = await extendManualMembership({
      actorId: admin.id,
      membershipId,
      method: "WHISH",
      reference: "REF-SECRET-2",
      note: "Extension note text",
    });
    await voidPaymentAction(IDLE, form({ paymentId: extensionId, reason: "Void reason text" }));
    await rejectFreezeAction(IDLE, form({ freezeId: freeze.id, reason: "Reject reason text" }));
    await adminRevokeInviteAction(IDLE, form({ inviteId: invite.id }));
    await adminRemovePartnerAction(IDLE, form({ seatId: seat.id }));

    const details = await auditDetails();
    expect(await db.auditLog.count()).toBeGreaterThanOrEqual(7);
    for (const text of [REFERENCE, "REF-SECRET-2", NOTE, "Extension note text", "Refund reason text", "Void reason text", "Reject reason text", INVITE_EMAIL, "@"]) {
      expect(details).not.toContain(text);
    }
  });
});

describe("every admin action, for a member or trainer", () => {
  it.each<Role>(["MEMBER", "TRAINER"])("is refused for a %s, and nothing changes", async (role) => {
    const { membershipId, paymentId, freeze, seat, invite } = await recorded();
    signInAs(await createUser({ role }));
    const before = await db.membership.findUniqueOrThrow({ where: { id: membershipId } });
    const auditRows = await db.auditLog.count();

    const attempts: [string, Promise<ActionResult>][] = [
      ["extend", extendMembershipAction(IDLE, form({ membershipId, method: "CASH" }))],
      ["void", voidPaymentAction(IDLE, form({ paymentId, reason: "Recorded twice" }))],
      ["refund", refundPaymentAction(IDLE, form({ paymentId, amount: "10", reason: "Goodwill" }))],
      ["approve", approveFreezeAction(IDLE, form({ freezeId: freeze.id }))],
      ["reject", rejectFreezeAction(IDLE, form({ freezeId: freeze.id, reason: "No" }))],
      ["cancel", cancelFreezeAction(IDLE, form({ freezeId: freeze.id }))],
      ["remove partner", adminRemovePartnerAction(IDLE, form({ seatId: seat.id }))],
      ["revoke invite", adminRevokeInviteAction(IDLE, form({ inviteId: invite.id }))],
    ];
    for (const [name, attempt] of attempts) {
      expect([name, await attempt]).toEqual([name, { status: "error", message: AUTH_ERROR_MESSAGES.FORBIDDEN }]);
    }

    expect(await db.membership.findUniqueOrThrow({ where: { id: membershipId } })).toEqual(before);
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ status: "SUCCEEDED", amountRefundedCents: 0 });
    expect(await db.payment.count()).toBe(1);
    expect(await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id } })).toMatchObject({ status: "REQUESTED" });
    expect(await db.membershipMember.findUniqueOrThrow({ where: { id: seat.id } })).toMatchObject({ endedAt: null });
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({ status: "PENDING" });
    expect(await db.auditLog.count()).toBe(auditRows);
    expect(cache.refresh).not.toHaveBeenCalled();
  });
});
