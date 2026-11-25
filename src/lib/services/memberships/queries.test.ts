import { randomInt } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { AuthError, type SessionUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { resetDatabase } from "../../../../tests/support/database";
import {
  createClassPackPlan,
  createCouplesPlan,
  createDayPassPlan,
  createFreeze,
  createGymTrialPlan,
  createMembership,
  createMembershipInvite,
  createOwnedMembership,
  createPlan,
  createSeat,
  createUser,
} from "../../../../tests/support/factories";
import { refundPayment, voidPayment } from "./corrections";
import { approveFreeze, requestFreeze } from "./freezes";
import { createManualMembership, extendManualMembership } from "./manual";
import {
  MEMBERSHIP_STATUSES,
  getMemberDetail,
  getMembershipDetail,
  getMyMemberships,
  getMyTrialEligibility,
  listJoinablePlans,
  listMembers,
  listMemberships,
  listPayments,
  listPendingFreezes,
} from "./queries";
import { effectiveStatus } from "./rules";
import { startTrial } from "./trials";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));

vi.mock("@/lib/auth/session", async () => {
  const { createGuards } = await import("@/lib/auth/guards");
  return createGuards(async () => session.user);
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Wednesday 2 December 2026, 10:00 in Beirut (UTC+2). The gym is open 06:00-22:00 every day.
const NOW = new Date("2026-12-02T08:00:00.000Z");
const ONE_MONTH_LATER = new Date("2027-01-02T08:00:00.000Z");
const TWO_MONTHS_LATER = new Date("2027-02-02T08:00:00.000Z");
// Local midnight starting Friday 4 December (the earliest freeze start from NOW).
const DEC_4 = new Date("2026-12-03T22:00:00.000Z");
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
  session.user = null;
  vi.useRealTimers();
});

function signInAs(user: { id: string; name: string; email: string; role: Role }) {
  session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
}

async function authErrorCode(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AuthError);
  return (error as AuthError).code;
}

function randomIp() {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

/** An admin, a member, and a manual membership on `plan` (a new Basic plan by default). */
async function manualMembership(
  options: { plan?: { id: string }; admin?: Awaited<ReturnType<typeof createUser>>; note?: string } = {},
) {
  const admin = options.admin ?? (await createUser({ role: "ADMIN" }));
  const member = await createUser({ name: "Member" });
  const plan = options.plan ?? (await createPlan({ name: "Basic" }));
  const created = await createManualMembership({
    actorId: admin.id,
    userId: member.id,
    planId: plan.id,
    method: "CASH",
    note: options.note,
  });
  return { admin, member, plan, ...created };
}

describe("authorization", () => {
  const adminQueries = {
    listMembers: () => listMembers({}),
    getMemberDetail: () => getMemberDetail(MISSING_ID),
    listMemberships: () => listMemberships({}),
    listPendingFreezes: () => listPendingFreezes(),
    getMembershipDetail: () => getMembershipDetail(MISSING_ID),
    listPayments: () => listPayments({}),
  };
  const memberQueries = {
    getMyMemberships: () => getMyMemberships(),
    getMyTrialEligibility: () => getMyTrialEligibility(),
    listJoinablePlans: () => listJoinablePlans(),
  };

  it.each(Object.entries(adminQueries))("%s rejects members and trainers", async (_name, query) => {
    for (const role of ["MEMBER", "TRAINER"] as const) {
      signInAs(await createUser({ role }));
      expect(await authErrorCode(query())).toBe("FORBIDDEN");
    }
  });

  it.each(Object.entries({ ...adminQueries, ...memberQueries }))("%s rejects signed-out visitors", async (_name, query) => {
    expect(await authErrorCode(query())).toBe("UNAUTHENTICATED");
  });

  it.each(Object.entries(adminQueries))("%s works for an admin", async (_name, query) => {
    signInAs(await createUser({ role: "ADMIN" }));
    await expect(query()).resolves.toBeDefined();
  });
});

describe("getMyMemberships", () => {
  it("returns only the memberships and payments of the signed-in person", async () => {
    const own = await manualMembership();
    const other = await manualMembership({ admin: own.admin });

    signInAs(own.member);
    const view = await getMyMemberships();

    expect(view.timeZone).toBe("Asia/Beirut");
    expect(view.current.map((m) => m.id)).toEqual([own.membershipId]);
    expect(view.past).toEqual([]);
    expect(view.payments.map((p) => p.id)).toEqual([own.paymentId]);
    expect(JSON.stringify(view)).not.toContain(other.membershipId);
  });

  it("shows the owner's payments without notes or references", async () => {
    const { member, paymentId } = await manualMembership({ note: "Paid at the desk" });

    signInAs(member);
    const [payment] = (await getMyMemberships()).payments;

    expect(payment).toMatchObject({ id: paymentId, planName: "Basic", status: "SUCCEEDED", amountCents: 3000, paidAt: NOW });
    expect(payment).not.toHaveProperty("note");
    expect(payment).not.toHaveProperty("reference");
  });

  it("shows the owner the partner, and the partner the owner but none of the owner's payments", async () => {
    const plan = await createCouplesPlan({ name: "Couples" });
    const { member: owner, membershipId } = await manualMembership({ plan });
    const partner = await createUser({ name: "Partner" });
    await createSeat(membershipId, partner.id, { role: "PARTNER" });

    signInAs(owner);
    const [ownerView] = (await getMyMemberships()).current;
    expect(ownerView.seat.role).toBe("OWNER");
    expect(ownerView.partners).toEqual([expect.objectContaining({ name: "Partner" })]);
    expect(ownerView.canInvite).toBe(false);

    signInAs(partner);
    const partnerView = await getMyMemberships();
    expect(partnerView.current).toHaveLength(1);
    expect(partnerView.current[0]).toMatchObject({
      id: membershipId,
      ownerName: "Member",
      seat: { role: "PARTNER" },
      partners: [],
      pendingInvite: null,
      freezeRequest: null,
      canInvite: false,
    });
    expect(partnerView.payments).toEqual([]);
  });

  it("shows a partner the approved freeze but not the owner's requests", async () => {
    const plan = await createCouplesPlan();
    const { admin, member: owner, membershipId } = await manualMembership({ plan });
    const partner = await createUser();
    await createSeat(membershipId, partner.id, { role: "PARTNER" });
    const requested = await requestFreeze({ userId: owner.id, membershipId, firstDay: "2026-12-04", lastDay: "2026-12-10" });

    signInAs(partner);
    expect((await getMyMemberships()).current[0].freezes).toEqual([]);

    await approveFreeze({ actorId: admin.id, freezeId: requested.freezeId });
    expect((await getMyMemberships()).current[0].freezes).toEqual([
      { id: requested.freezeId, status: "APPROVED", startsAt: DEC_4, endsAt: requested.endsAt, reason: null },
    ]);
  });

  it("lists a membership under past once the person's seat on it has ended", async () => {
    const plan = await createCouplesPlan();
    const { membershipId } = await manualMembership({ plan });
    const partner = await createUser();
    await createSeat(membershipId, partner.id, { role: "PARTNER", joinedAt: at(-2 * HOUR), endedAt: at(-HOUR) });

    signInAs(partner);
    const view = await getMyMemberships();

    expect(view.current).toEqual([]);
    expect(view.past).toEqual([expect.objectContaining({ id: membershipId, status: "ACTIVE", seat: expect.objectContaining({ endedAt: at(-HOUR) }) })]);
  });

  it("shows an overdue membership as expired under past", async () => {
    const member = await createUser();
    const plan = await createPlan();
    const end = at(-DAY);
    const membership = await createOwnedMembership(member, plan, { startsAt: at(-31 * DAY), currentPeriodEnd: end });

    signInAs(member);
    const view = await getMyMemberships();

    expect(view.current).toEqual([]);
    expect(view.past).toEqual([expect.objectContaining({ id: membership.id, status: "EXPIRED", usable: false, endedAt: end })]);
  });

  it("offers the owner an invite on a couples plan with a free seat, and shows the pending invite until it expires", async () => {
    const plan = await createCouplesPlan();
    const { member: owner, membershipId } = await manualMembership({ plan });

    signInAs(owner);
    expect((await getMyMemberships()).current[0]).toMatchObject({ canInvite: true, pendingInvite: null });

    const invite = await createMembershipInvite(membershipId, owner.id, { email: "partner@example.test" });
    expect((await getMyMemberships()).current[0].pendingInvite).toEqual({
      id: invite.id,
      email: "partner@example.test",
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
    });

    vi.setSystemTime(invite.expiresAt);
    expect((await getMyMemberships()).current[0].pendingInvite).toBeNull();
  });

  it("offers a freeze request from the day after tomorrow until one is open, and shows a lapsed request as cancelled", async () => {
    const { member, membershipId } = await manualMembership();

    signInAs(member);
    expect((await getMyMemberships()).current[0].freezeRequest).toEqual({ earliestStart: DEC_4 });

    const requested = await requestFreeze({ userId: member.id, membershipId, firstDay: "2026-12-04", lastDay: "2026-12-10" });
    const pending = (await getMyMemberships()).current[0];
    expect(pending.freezeRequest).toBeNull();
    expect(pending.freezes).toEqual([expect.objectContaining({ id: requested.freezeId, status: "REQUESTED" })]);

    vi.setSystemTime(DEC_4);
    const lapsed = (await getMyMemberships()).current[0];
    expect(lapsed.freezes).toEqual([expect.objectContaining({ id: requested.freezeId, status: "CANCELLED" })]);
    expect(lapsed.freezeRequest).not.toBeNull();
  });

  it("shows the credit balance on credit plans and the closing-time end of a Day Pass", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { member } = await manualMembership({ admin, plan: await createDayPassPlan({ name: "Day Pass" }) });
    const pack = await createClassPackPlan({ name: "Class Pack" });
    await createManualMembership({ actorId: admin.id, userId: member.id, planId: pack.id, method: "CASH" });

    signInAs(member);
    const { current } = await getMyMemberships();
    const dayPass = current.find((m) => m.plan.name === "Day Pass");
    const classPack = current.find((m) => m.plan.name === "Class Pack");

    expect(dayPass).toMatchObject({ endsAtClosing: true, creditBalance: null, freezeRequest: null });
    expect(dayPass?.currentPeriodEnd).toEqual(new Date("2026-12-02T20:00:00.000Z"));
    expect(classPack).toMatchObject({ endsAtClosing: false, creditBalance: 10 });
  });
});

describe("listJoinablePlans and getMyTrialEligibility", () => {
  it("lists active non-trial plans and the person's trial eligibility", async () => {
    const member = await createUser();
    await createPlan({ name: "Basic", sortOrder: 1 });
    await createPlan({ name: "Retired", active: false });
    await createDayPassPlan({ name: "Day Pass", sortOrder: 0 });
    await createGymTrialPlan({ name: "Gym Trial" });

    signInAs(member);
    expect((await listJoinablePlans()).map((p) => p.name)).toEqual(["Day Pass", "Basic"]);
    expect(await getMyTrialEligibility()).toMatchObject({
      GYM: { eligible: true, planName: "Gym Trial" },
      CLASS: { eligible: false, reason: "TRIAL_UNAVAILABLE" },
    });
  });
});

describe("listPendingFreezes", () => {
  it("lists requested freezes that haven't started, soonest first, and hides a request whose start has passed", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const soon = await manualMembership({ admin });
    const later = await manualMembership({ admin });
    const approved = await manualMembership({ admin });

    const stale = await requestFreeze({ userId: soon.member.id, membershipId: soon.membershipId, firstDay: "2026-12-04", lastDay: "2026-12-05" });
    const open = await requestFreeze({ userId: later.member.id, membershipId: later.membershipId, firstDay: "2026-12-17", lastDay: "2026-12-20" });
    const decided = await requestFreeze({ userId: approved.member.id, membershipId: approved.membershipId, firstDay: "2026-12-10", lastDay: "2026-12-12" });
    await approveFreeze({ actorId: admin.id, freezeId: decided.freezeId });

    signInAs(admin);
    expect((await listPendingFreezes()).freezes.map((f) => f.id)).toEqual([stale.freezeId, open.freezeId]);
    expect((await listPendingFreezes()).freezes[0]).toMatchObject({
      membershipId: soon.membershipId,
      owner: { id: soon.member.id, name: "Member" },
      planName: "Basic",
      startsAt: DEC_4,
      requestedAt: NOW,
      currentPeriodEnd: ONE_MONTH_LATER,
    });

    vi.setSystemTime(DEC_4);
    expect((await listPendingFreezes()).freezes.map((f) => f.id)).toEqual([open.freezeId]);
    // Hidden before anything settles it: the stored status is still REQUESTED.
    expect((await db.membershipFreeze.findUniqueOrThrow({ where: { id: stale.freezeId } })).status).toBe("REQUESTED");
  });

  it("hides a request on a membership whose period is over", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const member = await createUser();
    const plan = await createPlan();
    const membership = await createOwnedMembership(member, plan, { startsAt: at(-31 * DAY), currentPeriodEnd: at(-HOUR) });
    await createFreeze(membership.id, member.id, { startsAt: at(2 * DAY) });

    signInAs(admin);
    expect((await listPendingFreezes()).freezes).toEqual([]);
  });
});

describe("listMemberships", () => {
  /** One membership in each state the display status distinguishes, each with its own owner. */
  async function membershipsInEveryState() {
    const basic = await createPlan({ name: "Basic" });
    const make = async (overrides: Parameters<typeof createMembership>[2]) => {
      const owner = await createUser();
      return createMembership(owner.id, basic.id, overrides);
    };
    const pastStart = at(-31 * DAY);

    const active = await make({});
    const overdue = await make({ startsAt: pastStart, currentPeriodEnd: at(-HOUR) });
    const expired = await make({ status: "EXPIRED", startsAt: pastStart, currentPeriodEnd: at(-DAY) });
    const cancelled = await make({ status: "CANCELLED" });
    const frozen = await make({});
    await createFreeze(frozen.id, frozen.ownerId, { status: "APPROVED", startsAt: at(-DAY), endsAt: at(3 * DAY) });
    const futureFreeze = await make({});
    await createFreeze(futureFreeze.id, futureFreeze.ownerId, { status: "APPROVED", startsAt: at(2 * DAY) });
    const renewing = await make({ source: "STRIPE", startsAt: pastStart, currentPeriodEnd: at(-HOUR) });
    const cancelling = await make({ source: "STRIPE", startsAt: pastStart, currentPeriodEnd: at(-HOUR) });
    await db.membership.update({ where: { id: cancelling.id }, data: { stripeSubscriptionId: "sub_cancelling", cancelAtPeriodEnd: true } });
    const pastDue = await make({ source: "STRIPE", status: "PAST_DUE" });

    return { basic, active, overdue, expired, cancelled, frozen, futureFreeze, renewing, cancelling, pastDue };
  }

  it("filters by the display status the rules work out", async () => {
    const m = await membershipsInEveryState();
    signInAs(await createUser({ role: "ADMIN" }));

    const ids = async (status: string) => (await listMemberships({ status })).memberships.map((row) => row.id).sort();
    const rows = await db.membership.findMany({
      include: { plan: true, freezes: { select: { status: true, startsAt: true, endsAt: true } } },
    });
    for (const status of MEMBERSHIP_STATUSES) {
      const expected = rows.filter((row) => effectiveStatus(row, row.freezes, NOW) === status).map((row) => row.id).sort();
      expect(await ids(status), status).toEqual(expected);
    }

    expect(await ids("ACTIVE")).toEqual([m.active.id, m.futureFreeze.id, m.renewing.id].sort());
    expect(await ids("EXPIRED")).toEqual([m.overdue.id, m.expired.id].sort());
    expect(await ids("CANCELLED")).toEqual([m.cancelled.id, m.cancelling.id].sort());
    expect(await ids("FROZEN")).toEqual([m.frozen.id]);
    expect(await ids("PAST_DUE")).toEqual([m.pastDue.id]);
  });

  it("returns display statuses and ignores unknown filter values", async () => {
    const m = await membershipsInEveryState();
    signInAs(await createUser({ role: "ADMIN" }));

    const result = await listMemberships({ status: "BOGUS", source: "nope", planId: "not-a-uuid", page: "x" });
    expect(result.total).toBe(9);
    expect(result.filters).toEqual({ status: null, planId: null, source: null, expiring: false });
    expect(result.memberships.find((row) => row.id === m.overdue.id)).toMatchObject({ status: "EXPIRED", usable: false, endedAt: at(-HOUR) });
    expect(result.memberships.find((row) => row.id === m.frozen.id)).toMatchObject({ status: "FROZEN", usable: false });
  });

  it("lists running, non-renewing memberships ending within 7 days, soonest first", async () => {
    const plan = await createPlan();
    const make = async (overrides: Parameters<typeof createMembership>[2]) => {
      const owner = await createUser();
      return createMembership(owner.id, plan.id, { startsAt: at(-20 * DAY), ...overrides });
    };
    const sixDays = await make({ currentPeriodEnd: at(6 * DAY) });
    const sevenDays = await make({ currentPeriodEnd: at(7 * DAY) });
    await make({ currentPeriodEnd: at(7 * DAY + 1) });
    const oneDay = await make({ currentPeriodEnd: at(DAY) });
    await make({ currentPeriodEnd: at(-HOUR) });
    await make({ source: "STRIPE", currentPeriodEnd: at(2 * DAY) });

    signInAs(await createUser({ role: "ADMIN" }));
    const result = await listMemberships({ expiring: "true" });
    expect(result.memberships.map((row) => row.id)).toEqual([oneDay.id, sixDays.id, sevenDays.id]);
    expect(result.filters.expiring).toBe(true);
  });

  it("filters by plan and source, and pages", async () => {
    const basic = await createPlan({ name: "Basic" });
    const premium = await createPlan({ name: "Premium" });
    for (let i = 0; i < 26; i++) await createMembership((await createUser()).id, basic.id);
    const premiumRow = await createMembership((await createUser()).id, premium.id);
    const trial = await createMembership((await createUser()).id, basic.id, { source: "TRIAL" });

    signInAs(await createUser({ role: "ADMIN" }));
    expect((await listMemberships({ planId: premium.id })).memberships.map((row) => row.id)).toEqual([premiumRow.id]);
    expect((await listMemberships({ source: "TRIAL" })).memberships.map((row) => row.id)).toEqual([trial.id]);

    const first = await listMemberships({ planId: basic.id });
    const second = await listMemberships({ planId: basic.id, page: "2" });
    expect(first).toMatchObject({ total: 27, pageCount: 2, page: 1 });
    expect(first.memberships).toHaveLength(25);
    expect(second.memberships).toHaveLength(2);
    expect(first.plans.map((p) => p.name).sort()).toEqual(["Basic", "Premium"]);
  });
});

describe("getMembershipDetail", () => {
  it("offers void and full refund only on the latest valid payment", async () => {
    const { admin, membershipId, paymentId: first } = await manualMembership();
    const { paymentId: second } = await extendManualMembership({ actorId: admin.id, membershipId, method: "CASH" });

    signInAs(admin);
    const corrections = async () =>
      Object.fromEntries((await getMembershipDetail(membershipId))!.payments.map((p) => [p.id, p.corrections]));

    expect(await corrections()).toEqual({
      [second]: { canVoid: true, canRefund: true, canRefundFull: true },
      [first]: { canVoid: false, canRefund: true, canRefundFull: false },
    });

    await voidPayment({ actorId: admin.id, paymentId: second, reason: "Recorded twice" });
    expect(await corrections()).toEqual({
      [second]: { canVoid: false, canRefund: false, canRefundFull: false },
      [first]: { canVoid: true, canRefund: true, canRefundFull: true },
    });

    await refundPayment({ actorId: admin.id, paymentId: first, amountCents: 1000, reason: "Goodwill" });
    expect((await corrections())[first]).toEqual({ canVoid: false, canRefund: false, canRefundFull: false });
  });

  it("shows payments with notes and correction details, the period, and the extension preview", async () => {
    const { admin, member, membershipId, paymentId } = await manualMembership({ note: "Paid at the desk" });
    signInAs(admin);

    const detail = await getMembershipDetail(membershipId);
    expect(detail?.membership).toMatchObject({
      id: membershipId,
      status: "ACTIVE",
      storedStatus: "ACTIVE",
      usable: true,
      owner: { id: member.id, name: "Member" },
      currentPeriodEnd: ONE_MONTH_LATER,
      extension: { priceCents: 3000, currency: "usd", newEnd: TWO_MONTHS_LATER },
    });
    expect(detail?.seats).toEqual([expect.objectContaining({ role: "OWNER", user: expect.objectContaining({ id: member.id }), endedAt: null })]);
    expect(detail?.payments[0]).toMatchObject({ id: paymentId, note: "Paid at the desk", recordedByName: "Test User", voidedAt: null });
    expect(detail?.credits).toBeNull();
  });

  it("shows display statuses of invites and freezes, and the audit trail of the membership and its rows", async () => {
    const plan = await createCouplesPlan();
    const { admin, member, membershipId, paymentId } = await manualMembership({ plan });
    const invite = await createMembershipInvite(membershipId, member.id, { createdAt: at(-8 * DAY), expiresAt: at(-DAY) });
    const freeze = await requestFreeze({ userId: member.id, membershipId, firstDay: "2026-12-04", lastDay: "2026-12-05" });
    await extendManualMembership({ actorId: admin.id, membershipId, method: "CASH" });
    vi.setSystemTime(DEC_4);

    signInAs(admin);
    const detail = await getMembershipDetail(membershipId);

    expect(detail?.invites).toEqual([expect.objectContaining({ id: invite.id, status: "EXPIRED", revokedBySystem: false })]);
    expect(detail?.freezes).toEqual([expect.objectContaining({ id: freeze.freezeId, status: "CANCELLED", requestedByName: "Member" })]);
    const trail = detail!.audit.map((row) => `${row.action}:${row.targetType}`);
    expect(trail).toEqual(
      expect.arrayContaining([
        "membership.created:membership",
        "payment.recorded:payment",
        "membership_freeze.requested:membership_freeze",
        "membership.extended:membership",
      ]),
    );
    expect(detail!.audit.find((row) => row.targetId === paymentId)?.actorName).toBe("Test User");
    expect(detail!.audit.map((row) => row.createdAt.getTime())).toEqual(
      [...detail!.audit.map((row) => row.createdAt.getTime())].sort((a, b) => b - a),
    );
  });

  it("shows the credit balance and ledger of a credit plan", async () => {
    const { admin, membershipId } = await manualMembership({ plan: await createClassPackPlan() });
    signInAs(admin);

    const detail = await getMembershipDetail(membershipId);
    expect(detail?.credits).toEqual({ balance: 10, entries: [expect.objectContaining({ delta: 10, reason: "GRANT" })] });
    expect(detail?.membership.extension).toBeNull();
  });

  it("returns null for an unknown or malformed id", async () => {
    signInAs(await createUser({ role: "ADMIN" }));
    expect(await getMembershipDetail(MISSING_ID)).toBeNull();
    expect(await getMembershipDetail("not-a-uuid")).toBeNull();
  });
});

describe("getMemberDetail", () => {
  it("explains what recording each plan would do to the open base", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const member = await createUser({ name: "Member" });
    await createGymTrialPlan({ name: "Gym Trial" });
    const basic = await createPlan({ name: "Basic", sortOrder: 1 });
    await createPlan({ name: "Premium", sortOrder: 2 });
    await createDayPassPlan({ name: "Day Pass", sortOrder: 3 });
    await createClassPackPlan({ name: "Class Pack", sortOrder: 4 });
    await startTrial({ userId: member.id, kind: "GYM", ip: randomIp(), ipHash: null });

    signInAs(admin);
    const outcomes = async () =>
      Object.fromEntries((await getMemberDetail(member.id))!.recordPayment.plans.map((p) => [p.name, p.replacement]));

    const onTrial = await getMemberDetail(member.id);
    expect(onTrial?.recordPayment.openBase).toMatchObject({ planName: "Gym Trial", seatRole: "OWNER" });
    expect(onTrial?.trialsUsed).toEqual([expect.objectContaining({ kind: "GYM", redeemedAt: NOW })]);
    expect(await outcomes()).toEqual({
      Basic: { action: "supersede" },
      Premium: { action: "supersede" },
      "Day Pass": { action: "conflict", reason: "DAY_PASS_OR_TRIAL" },
      "Class Pack": { action: "none" },
    });

    await createManualMembership({ actorId: admin.id, userId: member.id, planId: basic.id, method: "CASH" });
    const onBasic = await getMemberDetail(member.id);
    expect(onBasic?.recordPayment.openBase).toEqual({
      membershipId: expect.any(String),
      planName: "Basic",
      seatRole: "OWNER",
      remainingDays: 31,
      hasPartner: false,
    });
    expect(await outcomes()).toEqual({
      Basic: { action: "same_plan" },
      Premium: { action: "switch" },
      "Day Pass": { action: "conflict", reason: "SWITCH_TARGET_NOT_RECURRING" },
      "Class Pack": { action: "none" },
    });
    expect(onBasic?.memberships.map((m) => [m.plan.name, m.status])).toEqual([
      ["Basic", "ACTIVE"],
      ["Gym Trial", "CANCELLED"],
    ]);
    expect(onBasic?.memberships[0].extension).toEqual({ priceCents: 3000, currency: "usd", newEnd: TWO_MONTHS_LATER });
  });

  it("shows a partner's base as a partner seat, and ignores an open base whose period is over", async () => {
    const plan = await createCouplesPlan({ name: "Couples" });
    const { admin, member: owner, membershipId } = await manualMembership({ plan });
    const partner = await createUser();
    await createSeat(membershipId, partner.id, { role: "PARTNER" });
    const lapsed = await createUser();
    await createOwnedMembership(lapsed, await createPlan(), { startsAt: at(-31 * DAY), currentPeriodEnd: at(-HOUR) });

    signInAs(admin);
    const ownerDetail = await getMemberDetail(owner.id);
    expect(ownerDetail?.recordPayment.openBase).toMatchObject({ planName: "Couples", seatRole: "OWNER", hasPartner: true });
    const partnerDetail = await getMemberDetail(partner.id);
    expect(partnerDetail?.recordPayment.openBase).toMatchObject({ planName: "Couples", seatRole: "PARTNER", hasPartner: false });
    expect(partnerDetail?.recordPayment.plans.find((p) => p.name === "Couples")?.replacement).toEqual({
      action: "conflict",
      reason: "PARTNER_SEAT",
    });
    expect(partnerDetail?.payments).toEqual([]);

    const lapsedDetail = await getMemberDetail(lapsed.id);
    expect(lapsedDetail?.recordPayment.openBase).toBeNull();
    expect(lapsedDetail?.memberships[0]).toMatchObject({ status: "EXPIRED", extension: null });
  });

  it("marks a Day Pass closed for today after closing time", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const member = await createUser();
    await createDayPassPlan({ name: "Day Pass" });

    signInAs(admin);
    expect((await getMemberDetail(member.id))?.recordPayment.plans[0].closedForToday).toBe(false);
    vi.setSystemTime(new Date("2026-12-02T20:00:00.000Z"));
    expect((await getMemberDetail(member.id))?.recordPayment.plans[0].closedForToday).toBe(true);
  });

  it("returns the profile of an anonymized member without allowing payments, and null for an unknown one", async () => {
    const member = await createUser({ anonymizedAt: at(-DAY) });
    signInAs(await createUser({ role: "ADMIN" }));

    expect((await getMemberDetail(member.id))?.member.anonymized).toBe(true);
    expect((await getMemberDetail(member.id))?.recordPayment.allowed).toBe(false);
    expect(await getMemberDetail("missing-user")).toBeNull();
  });
});

describe("listMembers", () => {
  it("shows each person's open base, searches, and leaves out anonymized users", async () => {
    const plan = await createCouplesPlan({ name: "Couples" });
    const admin = await createUser({ role: "ADMIN", name: "Admin" });
    const { member: owner, membershipId } = await manualMembership({ plan, admin });
    const partner = await createUser({ name: "Partner Person" });
    await createSeat(membershipId, partner.id, { role: "PARTNER" });
    const without = await createUser({ name: "No Membership" });
    await createUser({ name: "Gone", anonymizedAt: at(-DAY) });

    signInAs(admin);
    const { members, total } = await listMembers({});
    const byId = Object.fromEntries(members.map((m) => [m.id, m.base]));

    expect(total).toBe(4);
    expect(byId[owner.id]).toMatchObject({ membershipId, planName: "Couples", seatRole: "OWNER", status: "ACTIVE" });
    expect(byId[partner.id]).toMatchObject({ membershipId, seatRole: "PARTNER" });
    expect(byId[without.id]).toBeNull();
    expect((await listMembers({ q: "partner" })).members.map((m) => m.id)).toEqual([partner.id]);
  });
});

describe("listPayments", () => {
  it("totals per currency without voided payments", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const usd = await manualMembership({ admin });
    const { paymentId: refunded } = await extendManualMembership({ actorId: admin.id, membershipId: usd.membershipId, method: "WHISH" });
    const voided = await manualMembership({ admin });
    const eur = await manualMembership({ admin, plan: await createPlan({ priceCents: 2500, currency: "eur" }) });

    await refundPayment({ actorId: admin.id, paymentId: refunded, amountCents: 500, reason: "Goodwill" });
    await voidPayment({ actorId: admin.id, paymentId: voided.paymentId, reason: "Recorded by mistake" });

    signInAs(admin);
    const all = await listPayments({});
    expect(all.total).toBe(4);
    expect(all.totals).toEqual([
      { currency: "eur", grossCents: 2500, refundedCents: 0, netCents: 2500, count: 1 },
      { currency: "usd", grossCents: 6000, refundedCents: 500, netCents: 5500, count: 2 },
    ]);

    const whish = await listPayments({ method: "WHISH" });
    expect(whish.payments.map((p) => p.id)).toEqual([refunded]);
    expect(whish.totals).toEqual([{ currency: "usd", grossCents: 3000, refundedCents: 500, netCents: 2500, count: 1 }]);

    const voidedOnly = await listPayments({ status: "VOIDED" });
    expect(voidedOnly.payments.map((p) => p.id)).toEqual([voided.paymentId]);
    expect(voidedOnly.totals).toEqual([]);
    expect(all.payments.find((p) => p.id === eur.paymentId)).toMatchObject({ member: { id: eur.member.id }, planName: "Test Plan" });
  });

  it("filters by local paid date in the gym's time zone", async () => {
    const admin = await createUser({ role: "ADMIN" });
    // 23:30 on 1 December and 00:30 on 2 December in Beirut.
    vi.setSystemTime(new Date("2026-12-01T21:30:00.000Z"));
    const lateDec1 = await manualMembership({ admin });
    vi.setSystemTime(new Date("2026-12-01T22:30:00.000Z"));
    const earlyDec2 = await manualMembership({ admin });
    vi.setSystemTime(NOW);

    signInAs(admin);
    const ids = async (params: object) => (await listPayments(params)).payments.map((p) => p.id);

    expect(await ids({ from: "2026-12-02", to: "2026-12-02" })).toEqual([earlyDec2.paymentId]);
    expect(await ids({ to: "2026-12-01" })).toEqual([lateDec1.paymentId]);
    expect(await ids({ from: "2026-12-01" })).toEqual([earlyDec2.paymentId, lateDec1.paymentId]);
    expect((await listPayments({ from: "2026-02-30" })).filters.from).toBeNull();
  });
});
