import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { formatLocalTime } from "@/lib/time";
import { resetDatabase } from "../../../../tests/support/database";
import {
  createClassPackPlan,
  createCouplesPlan,
  createDayPassPlan,
  createGymTrialPlan,
  createOwnedMembership,
  createPlan,
  createSeat,
  createUser,
} from "../../../../tests/support/factories";
import { expectMembershipError } from "../../../../tests/support/membership-errors";
import { approveFreeze, cancelFreeze, rejectFreeze, requestFreeze, type RequestFreezeInput } from "./freezes";
import { createManualMembership, extendManualMembership } from "./manual";
import { effectiveStatus, isUsableAt } from "./rules";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Wednesday 2 December 2026, 10:00 in Beirut (UTC+2). The gym is open 06:00-22:00 every day.
const NOW = new Date("2026-12-02T08:00:00.000Z");
const ONE_MONTH_LATER = new Date("2027-01-02T08:00:00.000Z");
const TWO_MONTHS_LATER = new Date("2027-02-02T08:00:00.000Z");
const THREE_MONTHS_LATER = new Date("2027-03-02T08:00:00.000Z");
// Local midnights in Beirut (UTC+2 in winter).
const DEC_4 = new Date("2026-12-03T22:00:00.000Z");
const DEC_10 = new Date("2026-12-09T22:00:00.000Z");
const DEC_17 = new Date("2026-12-16T22:00:00.000Z");
const MISSING_ID = "0190f2a0-0000-7000-8000-000000000000";

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const plus = (instant: Date, offsetMs: number) => new Date(instant.getTime() + offsetMs);

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

/** A member with a manual Basic membership from now for one month, plus `extensions` more months. */
async function manualMembership(extensions = 0) {
  const admin = await createUser({ role: "ADMIN" });
  const member = await createUser();
  const plan = await createPlan();
  const created = await createManualMembership({ actorId: admin.id, userId: member.id, planId: plan.id, method: "CASH" });
  const paymentIds = [created.paymentId];
  for (let i = 0; i < extensions; i++) {
    const extension = await extendManualMembership({ actorId: admin.id, membershipId: created.membershipId, method: "CASH" });
    paymentIds.push(extension.paymentId);
  }
  return { admin, member, membershipId: created.membershipId, paymentIds };
}

function request(member: { id: string }, membershipId: string, firstDay: string, lastDay: string, overrides: Partial<RequestFreezeInput> = {}) {
  return requestFreeze({ userId: member.id, membershipId, firstDay, lastDay, ipHash: "ip", ...overrides });
}

function approve(admin: { id: string }, freezeId: string) {
  return approveFreeze({ actorId: admin.id, freezeId, ipHash: "ip" });
}

function getFreeze(id: string) {
  return db.membershipFreeze.findUniqueOrThrow({ where: { id } });
}

function getMembership(id: string) {
  return db.membership.findUniqueOrThrow({ where: { id }, include: { plan: true } });
}

function paymentPeriods(membershipId: string) {
  return db.payment.findMany({
    where: { membershipId },
    orderBy: { periodStart: "asc" },
    select: { periodStart: true, periodEnd: true },
  });
}

function auditRows(action: string) {
  return db.auditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } });
}

/** Whether the membership grants access at `t`, from its stored state and freezes. */
async function usableAt(membershipId: string, t: Date) {
  const membership = await getMembership(membershipId);
  const freezes = await db.membershipFreeze.findMany({ where: { membershipId } });
  return isUsableAt(membership, freezes, t);
}

describe("requestFreeze", () => {
  it("records a request for whole local days, leaving the period unchanged, and audits it", async () => {
    const { member, membershipId } = await manualMembership();

    const result = await request(member, membershipId, "2026-12-10", "2026-12-16");

    expect(result).toEqual({
      freezeId: expect.any(String),
      membershipId,
      status: "REQUESTED",
      startsAt: DEC_10,
      endsAt: DEC_17,
      periodShift: null,
    });
    expect(await getFreeze(result.freezeId)).toMatchObject({
      membershipId,
      requestedById: member.id,
      status: "REQUESTED",
      startsAt: DEC_10,
      endsAt: DEC_17,
      decidedById: null,
      decidedAt: null,
      createdAt: NOW,
    });
    expect((await getMembership(membershipId)).currentPeriodEnd).toEqual(ONE_MONTH_LATER);
    expect(await auditRows("membership_freeze.requested")).toEqual([
      expect.objectContaining({
        actorId: member.id,
        targetType: "membership_freeze",
        targetId: result.freezeId,
        ipHash: "ip",
        createdAt: NOW,
        details: { membershipId, startsAt: DEC_10.toISOString(), endsAt: DEC_17.toISOString() },
      }),
    ]);
  });

  it("starts no earlier than the day after tomorrow", async () => {
    const { member, membershipId } = await manualMembership();

    const tooSoon = await expectMembershipError(request(member, membershipId, "2026-12-03", "2026-12-05"), "INVALID_FREEZE_DATES");
    expect(tooSoon.details).toEqual({ reason: "TOO_SOON" });

    await expect(request(member, membershipId, "2026-12-04", "2026-12-05")).resolves.toMatchObject({ startsAt: DEC_4 });
  });

  it("lasts 1 to 30 days and starts before the period end", async () => {
    const first = await manualMembership();
    const errors = [
      ["2026-12-10", "2026-12-09", "END_BEFORE_START"],
      ["2026-12-10", "2027-01-09", "TOO_LONG"],
      ["2027-01-03", "2027-01-03", "AFTER_PERIOD_END"],
    ] as const;
    for (const [firstDay, lastDay, reason] of errors) {
      const error = await expectMembershipError(request(first.member, first.membershipId, firstDay, lastDay), "INVALID_FREEZE_DATES");
      expect(error.details).toEqual({ reason });
    }
    await expect(request(first.member, first.membershipId, "2026-12-10", "2027-02-30")).rejects.toThrow(ZodError);

    await expect(request(first.member, first.membershipId, "2026-12-10", "2027-01-08")).resolves.toMatchObject({
      startsAt: DEC_10,
      endsAt: plus(DEC_10, 30 * DAY),
    });
    const second = await manualMembership();
    await expect(request(second.member, second.membershipId, "2027-01-02", "2027-01-02")).resolves.toMatchObject({
      startsAt: new Date("2027-01-01T22:00:00.000Z"),
      endsAt: new Date("2027-01-02T22:00:00.000Z"),
    });
  });

  it("allows 30 days across the October DST change, which are 30 days 1 hour long", async () => {
    // Friday 1 October 2027, 10:00 in Beirut (UTC+3); clocks go back to UTC+2 at midnight on 31 October.
    vi.setSystemTime(new Date("2027-10-01T07:00:00.000Z"));
    const { admin, member, membershipId } = await manualMembership();
    const end = (await getMembership(membershipId)).currentPeriodEnd;

    const freeze = await request(member, membershipId, "2027-10-15", "2027-11-13");

    expect(freeze.startsAt).toEqual(new Date("2027-10-14T21:00:00.000Z"));
    expect(freeze.endsAt).toEqual(new Date("2027-11-13T22:00:00.000Z"));
    expect((await approve(admin, freeze.freezeId)).periodShift).toEqual({ previousEnd: end, newEnd: plus(end, 30 * DAY + HOUR) });
  });

  it("is only for the owner, on a running manual membership on a recurring base plan", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const owner = await createUser();
    const partner = await createUser();
    const couples = await createManualMembership({
      actorId: admin.id,
      userId: owner.id,
      planId: (await createCouplesPlan()).id,
      method: "CASH",
    });
    await createSeat(couples.membershipId, partner.id, { role: "PARTNER", joinedAt: NOW });
    const range = ["2026-12-10", "2026-12-16"] as const;

    await expectMembershipError(request(partner, couples.membershipId, ...range), "NOT_OWNER");
    await expectMembershipError(request(admin, couples.membershipId, ...range), "NOT_OWNER");
    await expectMembershipError(request(owner, MISSING_ID, ...range), "MEMBERSHIP_NOT_FOUND");

    const notFreezable = [
      { plan: await createDayPassPlan() },
      { plan: await createClassPackPlan() },
      { plan: await createGymTrialPlan(), source: "TRIAL" as const },
      { plan: await createPlan(), source: "STRIPE" as const },
    ];
    for (const { plan, source } of notFreezable) {
      const other = await createUser();
      const membership = await createOwnedMembership(other, plan, { source });
      await expectMembershipError(request(other, membership.id, ...range), "NOT_FREEZABLE");
    }

    const lapsed = await manualMembership();
    vi.setSystemTime(at(31 * DAY));
    await expectMembershipError(request(lapsed.member, lapsed.membershipId, "2027-01-10", "2027-01-12"), "MEMBERSHIP_ENDED");

    await db.user.update({ where: { id: owner.id }, data: { anonymizedAt: NOW } });
    await expectMembershipError(request(owner, couples.membershipId, "2027-01-10", "2027-01-12"), "USER_ANONYMIZED");
    expect(await db.membershipFreeze.count()).toBe(0);
  });

  it("allows one open freeze; a lapsed request or a finished freeze no longer blocks a new one", async () => {
    const { admin, member, membershipId } = await manualMembership();
    const lapsing = await request(member, membershipId, "2026-12-10", "2026-12-16");
    await expectMembershipError(request(member, membershipId, "2026-12-20", "2026-12-21"), "FREEZE_ALREADY_OPEN");

    vi.setSystemTime(at(10 * DAY));
    const approved = await request(member, membershipId, "2026-12-20", "2026-12-21");
    expect((await getFreeze(lapsing.freezeId)).status).toBe("CANCELLED");
    expect(await auditRows("membership_freeze.cancelled")).toEqual([
      expect.objectContaining({ actorId: null, targetId: lapsing.freezeId, details: { membershipId, via: "lapsed" } }),
    ]);
    await approve(admin, approved.freezeId);
    await expectMembershipError(request(member, membershipId, "2026-12-28", "2026-12-29"), "FREEZE_ALREADY_OPEN");

    vi.setSystemTime(at(23 * DAY));
    await expect(request(member, membershipId, "2026-12-28", "2026-12-29")).resolves.toMatchObject({ status: "REQUESTED" });
    expect((await getFreeze(approved.freezeId)).status).toBe("COMPLETED");
  });

  it("opens one freeze under two concurrent requests", async () => {
    const { member, membershipId } = await manualMembership();

    const results = await Promise.allSettled([
      request(member, membershipId, "2026-12-10", "2026-12-16"),
      request(member, membershipId, "2026-12-20", "2026-12-21"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    await expectMembershipError(Promise.reject(rejected?.reason), "FREEZE_ALREADY_OPEN");
    expect(await db.membershipFreeze.count()).toBe(1);
  });
});

describe("approveFreeze", () => {
  it("moves the period end and the later payment periods back by the freeze length, and blocks access in the window", async () => {
    const { admin, member, membershipId } = await manualMembership(1);
    const { freezeId } = await request(member, membershipId, "2026-12-10", "2026-12-16");
    const later = at(HOUR);
    vi.setSystemTime(later);

    const result = await approve(admin, freezeId);

    const shiftedEnd = plus(TWO_MONTHS_LATER, 7 * DAY);
    expect(result).toMatchObject({ status: "APPROVED", periodShift: { previousEnd: TWO_MONTHS_LATER, newEnd: shiftedEnd } });
    expect(await getFreeze(freezeId)).toMatchObject({ status: "APPROVED", decidedById: admin.id, decidedAt: later });
    expect(await getMembership(membershipId)).toMatchObject({ status: "ACTIVE", currentPeriodStart: NOW, currentPeriodEnd: shiftedEnd });
    expect(await paymentPeriods(membershipId)).toEqual([
      { periodStart: NOW, periodEnd: plus(ONE_MONTH_LATER, 7 * DAY) },
      { periodStart: plus(ONE_MONTH_LATER, 7 * DAY), periodEnd: shiftedEnd },
    ]);
    expect(await auditRows("membership_freeze.approved")).toEqual([
      expect.objectContaining({
        actorId: admin.id,
        targetId: freezeId,
        ipHash: "ip",
        createdAt: later,
        details: { membershipId, previousEnd: TWO_MONTHS_LATER.toISOString(), newEnd: shiftedEnd.toISOString() },
      }),
    ]);

    expect(await usableAt(membershipId, plus(DEC_10, -1))).toBe(true);
    expect(await usableAt(membershipId, DEC_10)).toBe(false);
    expect(await usableAt(membershipId, plus(DEC_17, -1))).toBe(false);
    expect(await usableAt(membershipId, DEC_17)).toBe(true);
    const membership = await getMembership(membershipId);
    const freezes = await db.membershipFreeze.findMany({ where: { membershipId } });
    expect(effectiveStatus(membership, freezes, plus(DEC_10, DAY))).toBe("FROZEN");
    expect(effectiveStatus(membership, freezes, DEC_17)).toBe("ACTIVE");
  });

  it("shifts by exactly the window on Beirut's DST-start day, which starts at 01:00 and lasts 23 hours", async () => {
    // Wednesday 10 March 2027, 10:00 in Beirut (UTC+2); clocks jump from 00:00 to 01:00 on 28 March.
    vi.setSystemTime(new Date("2027-03-10T08:00:00.000Z"));
    const { admin, member, membershipId } = await manualMembership();
    const end = (await getMembership(membershipId)).currentPeriodEnd;

    const freeze = await request(member, membershipId, "2027-03-28", "2027-03-28");

    expect(freeze.startsAt).toEqual(new Date("2027-03-27T22:00:00.000Z"));
    expect(formatLocalTime(freeze.startsAt, "Asia/Beirut")).toBe("01:00");
    expect(freeze.endsAt.getTime() - freeze.startsAt.getTime()).toBe(23 * HOUR);

    expect((await approve(admin, freeze.freezeId)).periodShift).toEqual({ previousEnd: end, newEnd: plus(end, 23 * HOUR) });
    expect(await usableAt(membershipId, plus(freeze.startsAt, -1))).toBe(true);
    expect(await usableAt(membershipId, freeze.startsAt)).toBe(false);
    expect(await usableAt(membershipId, freeze.endsAt)).toBe(true);
  });

  it("rejects a freeze that has started or isn't requested, a non-admin actor, and an unknown freeze", async () => {
    const { admin, member, membershipId } = await manualMembership();
    const trainer = await createUser({ role: "TRAINER" });
    const { freezeId } = await request(member, membershipId, "2026-12-10", "2026-12-16");

    await expectMembershipError(approve(member, freezeId), "ACTOR_NOT_ADMIN");
    await expectMembershipError(approve(trainer, freezeId), "ACTOR_NOT_ADMIN");
    await expectMembershipError(approve(admin, MISSING_ID), "FREEZE_NOT_FOUND");

    vi.setSystemTime(DEC_10);
    await expectMembershipError(approve(admin, freezeId), "FREEZE_STARTED");
    expect((await getMembership(membershipId)).currentPeriodEnd).toEqual(ONE_MONTH_LATER);

    const other = await manualMembership();
    const approved = await request(other.member, other.membershipId, "2026-12-20", "2026-12-21");
    await approve(admin, approved.freezeId);
    await expectMembershipError(approve(admin, approved.freezeId), "FREEZE_NOT_OPEN");
  });
});

describe("rejectFreeze", () => {
  it("rejects a requested freeze with an optional reason kept out of the audit, leaving the period unchanged", async () => {
    const { admin, member, membershipId } = await manualMembership();
    const { freezeId } = await request(member, membershipId, "2026-12-10", "2026-12-16");

    await expect(
      rejectFreeze({ actorId: admin.id, freezeId, reason: "Call me at someone@example.test", ipHash: "ip" }),
    ).rejects.toThrow(ZodError);
    const result = await rejectFreeze({ actorId: admin.id, freezeId, reason: "  Peak season  ", ipHash: "ip" });

    expect(result).toMatchObject({ status: "REJECTED", periodShift: null });
    expect(await getFreeze(freezeId)).toMatchObject({ status: "REJECTED", decidedById: admin.id, decidedAt: NOW, reason: "Peak season" });
    expect((await getMembership(membershipId)).currentPeriodEnd).toEqual(ONE_MONTH_LATER);
    expect(await auditRows("membership_freeze.rejected")).toEqual([
      expect.objectContaining({ actorId: admin.id, targetId: freezeId, details: { membershipId } }),
    ]);
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain("Peak season");

    await expectMembershipError(rejectFreeze({ actorId: admin.id, freezeId, ipHash: "ip" }), "FREEZE_NOT_OPEN");
    await expect(request(member, membershipId, "2026-12-20", "2026-12-21")).resolves.toMatchObject({ status: "REQUESTED" });
  });

  it("stores no reason when none is given, and rejects a started freeze and a non-admin actor", async () => {
    const { admin, member, membershipId } = await manualMembership();
    const first = await request(member, membershipId, "2026-12-10", "2026-12-16");

    await expectMembershipError(rejectFreeze({ actorId: member.id, freezeId: first.freezeId, ipHash: "ip" }), "ACTOR_NOT_ADMIN");
    await rejectFreeze({ actorId: admin.id, freezeId: first.freezeId, reason: "  ", ipHash: "ip" });
    expect((await getFreeze(first.freezeId)).reason).toBeNull();

    const second = await request(member, membershipId, "2026-12-20", "2026-12-21");
    vi.setSystemTime(new Date("2026-12-19T22:00:00.000Z"));
    await expectMembershipError(rejectFreeze({ actorId: admin.id, freezeId: second.freezeId, ipHash: "ip" }), "FREEZE_STARTED");
  });
});

describe("cancelFreeze", () => {
  it("lets the owner cancel a requested freeze", async () => {
    const { member, membershipId } = await manualMembership();
    const { freezeId } = await request(member, membershipId, "2026-12-10", "2026-12-16");

    const result = await cancelFreeze({ actorId: member.id, freezeId, ipHash: "ip" });

    expect(result).toMatchObject({ status: "CANCELLED", periodShift: null });
    expect((await getFreeze(freezeId)).status).toBe("CANCELLED");
    expect(await auditRows("membership_freeze.cancelled")).toEqual([
      expect.objectContaining({
        actorId: member.id,
        targetId: freezeId,
        details: { membershipId, via: "owner", previousStatus: "REQUESTED" },
      }),
    ]);
  });

  it("undoes the shift of an approved freeze, including a payment recorded after the approval", async () => {
    const { admin, member, membershipId } = await manualMembership(1);
    const { freezeId } = await request(member, membershipId, "2026-12-10", "2026-12-16");
    await approve(admin, freezeId);
    await extendManualMembership({ actorId: admin.id, membershipId, method: "CASH" });
    expect((await getMembership(membershipId)).currentPeriodEnd).toEqual(plus(THREE_MONTHS_LATER, 7 * DAY));

    const result = await cancelFreeze({ actorId: admin.id, freezeId, ipHash: "ip" });

    expect(result.periodShift).toEqual({ previousEnd: plus(THREE_MONTHS_LATER, 7 * DAY), newEnd: THREE_MONTHS_LATER });
    expect((await getMembership(membershipId)).currentPeriodEnd).toEqual(THREE_MONTHS_LATER);
    expect(await paymentPeriods(membershipId)).toEqual([
      { periodStart: NOW, periodEnd: ONE_MONTH_LATER },
      { periodStart: ONE_MONTH_LATER, periodEnd: TWO_MONTHS_LATER },
      { periodStart: TWO_MONTHS_LATER, periodEnd: THREE_MONTHS_LATER },
    ]);
    expect(await usableAt(membershipId, DEC_10)).toBe(true);
    expect(await auditRows("membership_freeze.cancelled")).toEqual([
      expect.objectContaining({
        actorId: admin.id,
        targetId: freezeId,
        details: {
          membershipId,
          via: "admin",
          previousStatus: "APPROVED",
          previousEnd: plus(THREE_MONTHS_LATER, 7 * DAY).toISOString(),
          newEnd: THREE_MONTHS_LATER.toISOString(),
        },
      }),
    ]);
  });

  it("is only for the owner or an admin, before the freeze starts", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const owner = await createUser();
    const partner = await createUser();
    const trainer = await createUser({ role: "TRAINER" });
    const couples = await createManualMembership({
      actorId: admin.id,
      userId: owner.id,
      planId: (await createCouplesPlan()).id,
      method: "CASH",
    });
    await createSeat(couples.membershipId, partner.id, { role: "PARTNER", joinedAt: NOW });
    const { freezeId } = await request(owner, couples.membershipId, "2026-12-10", "2026-12-16");
    await approve(admin, freezeId);
    const cancel = (actor: { id: string }) => cancelFreeze({ actorId: actor.id, freezeId, ipHash: "ip" });

    await expectMembershipError(cancel(partner), "NOT_OWNER");
    await expectMembershipError(cancel(trainer), "NOT_OWNER");
    await expectMembershipError(cancelFreeze({ actorId: admin.id, freezeId: MISSING_ID, ipHash: "ip" }), "FREEZE_NOT_FOUND");

    vi.setSystemTime(DEC_10);
    await expectMembershipError(cancel(owner), "FREEZE_STARTED");
    await expectMembershipError(cancel(admin), "FREEZE_STARTED");
    expect((await getFreeze(freezeId)).status).toBe("APPROVED");
    expect((await getMembership(couples.membershipId)).currentPeriodEnd).toEqual(plus(ONE_MONTH_LATER, 7 * DAY));
  });
});
