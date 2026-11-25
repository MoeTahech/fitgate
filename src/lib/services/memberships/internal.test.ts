import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Plan } from "@/generated/prisma/client";
import { resetDatabase } from "../../../../tests/support/database";
import {
  createClassPackPlan,
  createCouplesPlan,
  createDayPassPlan,
  createFreeze,
  createGymTrialPlan,
  createManualPayment,
  createMembership,
  createMembershipInvite,
  createOwnedMembership,
  createPlan,
  createSeat,
  createUser,
} from "../../../../tests/support/factories";
import { expectMembershipError } from "../../../../tests/support/membership-errors";
import {
  endMembership,
  endOverdueMemberships,
  getGymClock,
  lockMembership,
  lockUsers,
  openBaseSeat,
  paidAccessHistory,
  requireActiveAdmin,
  requireActiveUser,
  resolveOpenBase,
  type Tx,
} from "./internal";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await resetDatabase();
});

function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(fn);
}

async function auditRows(action: string) {
  return db.auditLog.findMany({ where: { action }, orderBy: { id: "asc" } });
}

describe("lockUsers and actor checks", () => {
  it("locks each id once and returns the rows in id order", async () => {
    const a = await createUser();
    const b = await createUser();
    const rows = await inTx((tx) => lockUsers(tx, [b.id, a.id, b.id, "missing"]));
    expect(rows.map((row) => row.id)).toEqual([a.id, b.id].sort());
    expect(rows[0]).toMatchObject({ role: "MEMBER", emailVerified: true, anonymizedAt: null });
  });

  it("accepts only an active admin as actor", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const trainer = await createUser({ role: "TRAINER" });
    const gone = await createUser({ role: "ADMIN", anonymizedAt: new Date() });
    const rows = await inTx((tx) => lockUsers(tx, [admin.id, trainer.id, gone.id]));

    expect(requireActiveAdmin(rows, admin.id).id).toBe(admin.id);
    for (const id of [trainer.id, gone.id, "missing"]) {
      expect(() => requireActiveAdmin(rows, id)).toThrow(expect.objectContaining({ code: "ACTOR_NOT_ADMIN" }));
    }
  });

  it("rejects a missing or anonymized user", async () => {
    const user = await createUser();
    const gone = await createUser({ anonymizedAt: new Date() });
    const rows = await inTx((tx) => lockUsers(tx, [user.id, gone.id]));

    expect(requireActiveUser(rows, user.id).id).toBe(user.id);
    expect(() => requireActiveUser(rows, gone.id)).toThrow(expect.objectContaining({ code: "USER_ANONYMIZED" }));
    expect(() => requireActiveUser(rows, "missing")).toThrow(expect.objectContaining({ code: "USER_NOT_FOUND" }));
  });
});

describe("lockMembership", () => {
  it("returns the membership with its plan, or MEMBERSHIP_NOT_FOUND", async () => {
    const user = await createUser();
    const plan = await createPlan();
    const membership = await createMembership(user.id, plan.id);

    const locked = await inTx((tx) => lockMembership(tx, membership.id));
    expect(locked).toMatchObject({ id: membership.id, plan: { id: plan.id } });

    await expectMembershipError(
      inTx((tx) => lockMembership(tx, "0190f2a0-0000-7000-8000-000000000000")),
      "MEMBERSHIP_NOT_FOUND",
    );
  });
});

describe("getGymClock", () => {
  it("falls back to Asia/Beirut without gym settings", async () => {
    expect(await inTx(getGymClock)).toEqual({ timeZone: "Asia/Beirut", openingHours: [] });
  });

  it("reads the time zone and opening hours", async () => {
    await db.gymSettings.create({ data: { id: 1, name: "Gym", timeZone: "Europe/Paris", capacity: 50 } });
    await db.openingHours.createMany({
      data: [
        { weekday: 2, opensAtMin: 360, closesAtMin: 1320 },
        { weekday: 1, opensAtMin: 420, closesAtMin: 1440 },
      ],
    });
    expect(await inTx(getGymClock)).toEqual({
      timeZone: "Europe/Paris",
      openingHours: [
        { weekday: 1, opensAtMin: 420, closesAtMin: 1440 },
        { weekday: 2, opensAtMin: 360, closesAtMin: 1320 },
      ],
    });
  });
});

describe("endMembership", () => {
  it("ends the membership and its seats, revokes the invite, cancels a requested freeze, and audits", async () => {
    const now = new Date();
    const admin = await createUser({ role: "ADMIN" });
    const owner = await createUser();
    const partner = await createUser();
    const plan = await createCouplesPlan();
    const membership = await createOwnedMembership(owner, plan, { startsAt: new Date(now.getTime() - 10 * DAY) });
    const endedAt = new Date(now.getTime() - 2 * DAY);
    const partnerSeat = await createSeat(membership.id, partner.id, { role: "PARTNER", joinedAt: new Date(now.getTime() - DAY) });
    const invite = await createMembershipInvite(membership.id, owner.id, { createdAt: new Date(now.getTime() - HOUR) });
    const freeze = await createFreeze(membership.id, owner.id, { startsAt: new Date(now.getTime() + 3 * DAY) });

    await inTx((tx) =>
      endMembership(tx, membership, {
        status: "CANCELLED",
        endedAt,
        now,
        via: "switched",
        actorId: admin.id,
        ipHash: "ip",
        details: { fromPlanId: plan.id, toPlanId: "other" },
      }),
    );

    const row = await db.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(row).toMatchObject({ status: "CANCELLED", endedAt });

    const seats = await db.membershipMember.findMany({ where: { membershipId: membership.id } });
    expect(seats.find((s) => s.userId === owner.id)?.endedAt).toEqual(endedAt);
    expect(seats.find((s) => s.userId === partner.id)?.endedAt).toEqual(partnerSeat.joinedAt);

    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({
      status: "REVOKED",
      revokedAt: now,
      revokedById: null,
    });
    expect((await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id } })).status).toBe("CANCELLED");

    const [ended] = await auditRows("membership.ended");
    expect(ended).toMatchObject({
      actorId: admin.id,
      targetType: "membership",
      targetId: membership.id,
      ipHash: "ip",
      createdAt: now,
      details: { status: "CANCELLED", via: "switched", fromPlanId: plan.id, toPlanId: "other" },
    });
    expect(await auditRows("membership_invite.revoked")).toEqual([
      expect.objectContaining({ targetId: invite.id, actorId: admin.id, details: { via: "membership_ended" }, createdAt: now }),
    ]);
    expect(await auditRows("membership_freeze.cancelled")).toEqual([
      expect.objectContaining({ targetId: freeze.id, details: { via: "membership_ended" } }),
    ]);
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(invite.email);
  });

  it("completes a started approved freeze and cancels a future one", async () => {
    const now = new Date();
    const admin = await createUser({ role: "ADMIN" });
    const owner = await createUser();
    const plan = await createPlan({ type: "ADDON", openAccess: false, classAccess: "UNLIMITED" });
    const started = await createOwnedMembership(owner, plan, { startsAt: new Date(now.getTime() - 10 * DAY) });
    const future = await createOwnedMembership(owner, plan, { startsAt: new Date(now.getTime() - 10 * DAY) });
    const startedFreeze = await createFreeze(started.id, owner.id, {
      status: "APPROVED",
      startsAt: new Date(now.getTime() - DAY),
      decidedById: admin.id,
    });
    const futureFreeze = await createFreeze(future.id, owner.id, {
      status: "APPROVED",
      startsAt: new Date(now.getTime() + DAY),
      decidedById: admin.id,
    });

    await inTx(async (tx) => {
      for (const m of [started, future]) {
        await endMembership(tx, m, { status: "CANCELLED", endedAt: now, now, via: "void", actorId: admin.id, ipHash: null });
      }
    });

    expect((await db.membershipFreeze.findUniqueOrThrow({ where: { id: startedFreeze.id } })).status).toBe("COMPLETED");
    expect((await db.membershipFreeze.findUniqueOrThrow({ where: { id: futureFreeze.id } })).status).toBe("CANCELLED");
    expect((await auditRows("membership_freeze.cancelled")).map((r) => r.targetId)).toEqual([futureFreeze.id]);
  });
});

describe("endOverdueMemberships", () => {
  it("ends the person's overdue memberships, owned or as partner, and leaves the rest", async () => {
    const now = new Date();
    const user = await createUser();
    const other = await createUser();
    const base = await createCouplesPlan();
    const addon = await createClassPackPlan();
    const start = new Date(now.getTime() - 40 * DAY);

    const overdueOwned = await createOwnedMembership(user, addon, { startsAt: start, currentPeriodEnd: new Date(now.getTime() - DAY) });
    const overdueShared = await createOwnedMembership(other, base, { startsAt: start, currentPeriodEnd: now });
    await createSeat(overdueShared.id, user.id, { role: "PARTNER", joinedAt: start });
    const running = await createOwnedMembership(user, await createPlan({ type: "ADDON", openAccess: false, classAccess: "UNLIMITED" }), {
      startsAt: start,
      currentPeriodEnd: new Date(now.getTime() + 1),
    });
    const alreadyEnded = await createOwnedMembership(user, addon, { startsAt: start, currentPeriodEnd: new Date(now.getTime() - 2 * DAY), status: "EXPIRED" });
    const notSeated = await createOwnedMembership(other, addon, { startsAt: start, currentPeriodEnd: new Date(now.getTime() - DAY) });

    const ended = await inTx((tx) => endOverdueMemberships(tx, user.id, now, "manual_create"));

    expect(ended.sort()).toEqual([overdueOwned.id, overdueShared.id].sort());
    for (const m of [overdueOwned, overdueShared]) {
      expect(await db.membership.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({
        status: "EXPIRED",
        endedAt: m.currentPeriodEnd,
      });
      expect(await db.membershipMember.count({ where: { membershipId: m.id, endedAt: null } })).toBe(0);
    }
    for (const m of [running, notSeated]) {
      expect((await db.membership.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ACTIVE");
    }
    expect((await db.membership.findUniqueOrThrow({ where: { id: alreadyEnded.id } })).status).toBe("EXPIRED");

    const audits = await auditRows("membership.ended");
    expect(audits).toHaveLength(2);
    for (const row of audits) {
      expect(row).toMatchObject({
        actorId: null,
        ipHash: null,
        details: { status: "EXPIRED", via: "overdue_cleanup", trigger: "manual_create" },
      });
    }
  });

  it("cancels a Stripe subscription set to cancel at period end and leaves an auto-renewing one", async () => {
    const now = new Date();
    const user = await createUser();
    const plan = await createPlan({ type: "ADDON", openAccess: false, classAccess: "UNLIMITED" });
    const options = { source: "STRIPE" as const, startsAt: new Date(now.getTime() - 40 * DAY), currentPeriodEnd: new Date(now.getTime() - HOUR) };
    const cancelling = await createOwnedMembership(user, plan, options);
    await db.membership.update({ where: { id: cancelling.id }, data: { stripeSubscriptionId: "sub_1", cancelAtPeriodEnd: true } });
    const renewing = await createOwnedMembership(user, plan, options);
    await db.membership.update({ where: { id: renewing.id }, data: { stripeSubscriptionId: "sub_2" } });

    expect(await inTx((tx) => endOverdueMemberships(tx, user.id, now, "trial_start"))).toEqual([cancelling.id]);
    expect((await db.membership.findUniqueOrThrow({ where: { id: cancelling.id } })).status).toBe("CANCELLED");
    expect((await db.membership.findUniqueOrThrow({ where: { id: renewing.id } })).status).toBe("ACTIVE");
  });
});

describe("paidAccessHistory", () => {
  it("is empty without paid memberships, and ignores trials and voided-only memberships", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const user = await createUser();
    expect(await inTx((tx) => paidAccessHistory(tx, user.id))).toEqual({ openAccess: false, classAccess: false });

    await createOwnedMembership(user, await createGymTrialPlan(), { source: "TRIAL", status: "EXPIRED" });
    const voided = await createOwnedMembership(user, await createCouplesPlan(), { status: "CANCELLED" });
    await createManualPayment(voided, admin.id, { status: "VOIDED" });

    expect(await inTx((tx) => paidAccessHistory(tx, user.id))).toEqual({ openAccess: false, classAccess: false });
  });

  it("counts a past Day Pass as open access only and a class pack as class access only", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const dayPassUser = await createUser();
    const packUser = await createUser();
    const dayPass = await createOwnedMembership(dayPassUser, await createDayPassPlan(), { status: "EXPIRED" });
    await createManualPayment(dayPass, admin.id);
    const pack = await createOwnedMembership(packUser, await createClassPackPlan());
    await createManualPayment(pack, admin.id);

    expect(await inTx((tx) => paidAccessHistory(tx, dayPassUser.id))).toEqual({ openAccess: true, classAccess: false });
    expect(await inTx((tx) => paidAccessHistory(tx, packUser.id))).toEqual({ openAccess: false, classAccess: true });
  });

  it("counts an ended partner seat and a Stripe membership", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const owner = await createUser();
    const partner = await createUser();
    const stripeUser = await createUser();
    const couples = await createCouplesPlan();
    const shared = await createOwnedMembership(owner, couples);
    await createManualPayment(shared, admin.id);
    await createSeat(shared.id, partner.id, { role: "PARTNER", joinedAt: shared.startsAt, endedAt: new Date(shared.startsAt.getTime() + DAY) });
    await createOwnedMembership(stripeUser, couples, { source: "STRIPE" });

    expect(await inTx((tx) => paidAccessHistory(tx, partner.id))).toEqual({ openAccess: true, classAccess: true });
    expect(await inTx((tx) => paidAccessHistory(tx, stripeUser.id))).toEqual({ openAccess: true, classAccess: true });
  });
});

describe("resolveOpenBase", () => {
  async function resolve(input: { memberId: string; plan: Plan; confirmSwitch?: boolean; actorId: string; now?: Date }) {
    return inTx((tx) =>
      resolveOpenBase(tx, {
        memberId: input.memberId,
        plan: input.plan,
        confirmSwitch: input.confirmSwitch ?? false,
        now: input.now ?? new Date(),
        timeZone: "Asia/Beirut",
        actorId: input.actorId,
        ipHash: "ip",
      }),
    );
  }

  it("does nothing for an ADDON plan or a member without an open base", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const member = await createUser();
    await createOwnedMembership(member, await createPlan());
    expect(await resolve({ memberId: member.id, plan: await createClassPackPlan(), actorId: admin.id })).toEqual({ action: "none" });

    const fresh = await createUser();
    expect(await resolve({ memberId: fresh.id, plan: await createPlan(), actorId: admin.id })).toEqual({ action: "none" });
  });

  it.each([
    ["Gym Trial", createGymTrialPlan, "TRIAL" as const],
    ["Day Pass", createDayPassPlan, "MANUAL" as const],
  ])("supersedes an open %s with a recurring plan", async (_label, makePlan, source) => {
    const now = new Date();
    const admin = await createUser({ role: "ADMIN" });
    const member = await createUser();
    const open = await createOwnedMembership(member, await makePlan(), { source, currentPeriodEnd: new Date(now.getTime() + 8 * HOUR) });

    const result = await resolve({ memberId: member.id, plan: await createPlan(), actorId: admin.id, now });

    expect(result).toEqual({ action: "superseded", membershipId: open.id });
    expect(await db.membership.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({ status: "CANCELLED", endedAt: now });
    expect(await inTx((tx) => openBaseSeat(tx, member.id))).toBeNull();
    const [ended] = await auditRows("membership.ended");
    expect(ended).toMatchObject({ actorId: admin.id, targetId: open.id, details: { status: "CANCELLED", via: "superseded" } });
  });

  it("rejects a Day Pass on an open Gym Trial or Day Pass", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const dayPass = await createDayPassPlan();
    const trialMember = await createUser();
    const passMember = await createUser();
    await createOwnedMembership(trialMember, await createGymTrialPlan(), { source: "TRIAL" });
    await createOwnedMembership(passMember, dayPass);

    for (const member of [trialMember, passMember]) {
      const error = await expectMembershipError(resolve({ memberId: member.id, plan: dayPass, actorId: admin.id }), "HAS_ACTIVE_BASE");
      expect(error.details).toEqual({ reason: "DAY_PASS_OR_TRIAL" });
    }
    expect(await db.membership.count({ where: { status: "ACTIVE" } })).toBe(2);
  });

  it("asks to confirm a switch with the usable days left, excluding an approved future freeze", async () => {
    const now = new Date();
    const admin = await createUser({ role: "ADMIN" });
    const member = await createUser();
    const open = await createOwnedMembership(member, await createPlan(), {
      startsAt: new Date(now.getTime() - 10 * DAY),
      currentPeriodEnd: new Date(now.getTime() + 20 * DAY - HOUR),
    });
    const premium = await createPlan({ classAccess: "UNLIMITED" });

    const error = await expectMembershipError(resolve({ memberId: member.id, plan: premium, actorId: admin.id, now }), "HAS_ACTIVE_BASE");
    expect(error.details).toEqual({ reason: "SWITCH_NEEDS_CONFIRMATION", remainingDays: 20, hasPartner: false });

    await createFreeze(open.id, member.id, {
      status: "APPROVED",
      startsAt: new Date(now.getTime() + 5 * DAY),
      endsAt: new Date(now.getTime() + 12 * DAY),
      decidedById: admin.id,
    });
    const frozen = await expectMembershipError(resolve({ memberId: member.id, plan: premium, actorId: admin.id, now }), "HAS_ACTIVE_BASE");
    expect(frozen.details).toEqual({ reason: "SWITCH_NEEDS_CONFIRMATION", remainingDays: 13, hasPartner: false });

    expect((await db.membership.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("ACTIVE");
    expect(await auditRows("membership.ended")).toHaveLength(0);
  });

  it("switches a Couples membership with confirmation, removing the partner and keeping the payments", async () => {
    const now = new Date();
    const admin = await createUser({ role: "ADMIN" });
    const owner = await createUser();
    const partner = await createUser();
    const couples = await createCouplesPlan();
    const open = await createOwnedMembership(owner, couples, { startsAt: new Date(now.getTime() - DAY) });
    const payment = await createManualPayment(open, admin.id);
    await createSeat(open.id, partner.id, { role: "PARTNER", joinedAt: open.startsAt });
    const invite = await createMembershipInvite(open.id, owner.id);
    const freeze = await createFreeze(open.id, owner.id, { startsAt: new Date(now.getTime() + 3 * DAY) });
    const basic = await createPlan();

    const error = await expectMembershipError(resolve({ memberId: owner.id, plan: basic, actorId: admin.id, now }), "HAS_ACTIVE_BASE");
    expect(error.details).toEqual({ reason: "SWITCH_NEEDS_CONFIRMATION", remainingDays: 29, hasPartner: true });

    const result = await resolve({ memberId: owner.id, plan: basic, confirmSwitch: true, actorId: admin.id, now });

    expect(result).toEqual({ action: "switched", membershipId: open.id });
    expect(await db.membership.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({ status: "CANCELLED", endedAt: now });
    expect(await db.membershipMember.count({ where: { membershipId: open.id, endedAt: null } })).toBe(0);
    expect((await db.membershipInvite.findUniqueOrThrow({ where: { id: invite.id } })).status).toBe("REVOKED");
    expect((await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id } })).status).toBe("CANCELLED");
    expect(await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(payment);
    const [ended] = await auditRows("membership.ended");
    expect(ended.details).toEqual({ status: "CANCELLED", via: "switched", fromPlanId: couples.id, toPlanId: basic.id });
  });

  it("rejects the same plan with SAME_PLAN", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const member = await createUser();
    const plan = await createPlan();
    await createOwnedMembership(member, plan);
    await expectMembershipError(resolve({ memberId: member.id, plan, confirmSwitch: true, actorId: admin.id }), "SAME_PLAN");
  });

  it("never ends the owner's membership for a partner, nor a Stripe or other one-time base", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const owner = await createUser();
    const partner = await createUser();
    const stripeMember = await createUser();
    const oneTimeMember = await createUser();
    const shared = await createOwnedMembership(owner, await createCouplesPlan());
    await createSeat(shared.id, partner.id, { role: "PARTNER" });
    const stripeBase = await createOwnedMembership(stripeMember, await createPlan(), { source: "STRIPE" });
    const oneTimeBase = await createOwnedMembership(
      oneTimeMember,
      await createPlan({ billing: "ONE_TIME", intervalMonths: null, durationDays: 30, durationMode: "ROLLING" }),
    );
    const basic = await createPlan();

    const cases = [
      [partner, "PARTNER_SEAT"],
      [stripeMember, "STRIPE_BASE"],
      [oneTimeMember, "ONE_TIME_BASE"],
    ] as const;
    for (const [member, reason] of cases) {
      const error = await expectMembershipError(
        resolve({ memberId: member.id, plan: basic, confirmSwitch: true, actorId: admin.id }),
        "HAS_ACTIVE_BASE",
      );
      expect(error.details).toEqual({ reason });
    }
    for (const m of [shared, stripeBase, oneTimeBase]) {
      expect((await db.membership.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ACTIVE");
    }
    expect(await db.membershipMember.count({ where: { endedAt: null } })).toBe(4);
  });
});
