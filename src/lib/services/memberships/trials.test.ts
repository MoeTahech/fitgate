import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { keyedHash } from "@/lib/crypto";
import { db } from "@/lib/db";
import { resetDatabase } from "../../../../tests/support/database";
import {
  createClassPackPlan,
  createClassTrialPlan,
  createCouplesPlan,
  createDayPassPlan,
  createGymTrialPlan,
  createManualPayment,
  createOwnedMembership,
  createPlan,
  createSeat,
  createUser,
} from "../../../../tests/support/factories";
import { expectMembershipError } from "../../../../tests/support/membership-errors";
import { startTrial, trialEligibility, trialIpIdentifier, type StartTrialInput } from "./trials";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Wednesday 2 December 2026, 10:00 in Beirut (UTC+2). The gym is open 06:00-22:00 every day.
const NOW = new Date("2026-12-02T08:00:00.000Z");
const CLOSING_TODAY = new Date("2026-12-02T20:00:00.000Z");
const SEVEN_DAYS_LATER = new Date("2026-12-09T08:00:00.000Z");
const WEDNESDAY = 3;

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

/** A fresh client IP per call site, so rate-limit keys never collide across tests or runs. */
const randomIp = () => `test-ip-${randomUUID()}`;

let ip: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  ip = randomIp();
  await resetDatabase();
  await db.gymSettings.create({ data: { id: 1, name: "Gym", timeZone: "Asia/Beirut", capacity: 50 } });
  await db.openingHours.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAtMin: 360, closesAtMin: 1320 })),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function trialPlans() {
  return { gym: await createGymTrialPlan({ name: "Gym Trial" }), cls: await createClassTrialPlan({ name: "Class Trial" }) };
}

function start(user: { id: string }, kind: StartTrialInput["kind"], overrides: Partial<StartTrialInput> = {}) {
  return startTrial({ userId: user.id, kind, ip, ipHash: "ip-hash", ...overrides });
}

/** A paid manual membership the person owns, ended 10 days ago (or still running with `running`). */
async function paidMembership(owner: { id: string }, plan: { id: string; type: "BASE" | "ADDON" }, running = false) {
  const admin = await createUser({ role: "ADMIN" });
  const membership = await createOwnedMembership(
    owner,
    plan,
    running
      ? { createdById: admin.id, startsAt: at(-5 * DAY), currentPeriodEnd: at(25 * DAY) }
      : { createdById: admin.id, status: "EXPIRED", startsAt: at(-40 * DAY), currentPeriodEnd: at(-10 * DAY) },
  );
  await createManualPayment(membership, admin.id);
  return membership;
}

describe("startTrial", () => {
  it("starts a Gym Trial until today's closing time with an owner seat and a redemption, and no payment", async () => {
    const { gym } = await trialPlans();
    const user = await createUser();

    const result = await start(user, "GYM");

    expect(result).toEqual({ membershipId: expect.any(String), kind: "GYM", periodStart: NOW, periodEnd: CLOSING_TODAY });
    expect(await db.membership.findUniqueOrThrow({ where: { id: result.membershipId } })).toMatchObject({
      ownerId: user.id,
      planId: gym.id,
      source: "TRIAL",
      status: "ACTIVE",
      createdById: null,
      startsAt: NOW,
      currentPeriodStart: NOW,
      currentPeriodEnd: CLOSING_TODAY,
      endedAt: null,
      createdAt: NOW,
    });
    expect(await db.membershipMember.findMany({ where: { membershipId: result.membershipId } })).toEqual([
      expect.objectContaining({ userId: user.id, role: "OWNER", planType: "BASE", joinedAt: NOW, endedAt: null }),
    ]);
    expect(await db.trialRedemption.findMany()).toEqual([
      expect.objectContaining({
        userId: user.id,
        membershipId: result.membershipId,
        kind: "GYM",
        emailHash: keyedHash("trial", user.email),
        phoneHash: null,
        createdAt: NOW,
      }),
    ]);
    expect(await db.payment.count()).toBe(0);
    expect(await db.creditLedger.count()).toBe(0);
    expect(await db.auditLog.findMany()).toEqual([
      expect.objectContaining({
        action: "membership.trial_started",
        actorId: user.id,
        targetType: "membership",
        targetId: result.membershipId,
        details: { kind: "GYM", planId: gym.id },
        ipHash: "ip-hash",
        createdAt: NOW,
      }),
    ]);
  });

  it("starts a Class Trial for 7 days with a 1-credit grant, alongside an open base", async () => {
    const { cls } = await trialPlans();
    const user = await createUser();
    await paidMembership(user, await createPlan(), true);

    const result = await start(user, "CLASS");

    expect(result).toEqual({ membershipId: expect.any(String), kind: "CLASS", periodStart: NOW, periodEnd: SEVEN_DAYS_LATER });
    expect(await db.membership.findUniqueOrThrow({ where: { id: result.membershipId } })).toMatchObject({
      planId: cls.id,
      source: "TRIAL",
      currentPeriodEnd: SEVEN_DAYS_LATER,
    });
    expect(await db.membershipMember.findMany({ where: { membershipId: result.membershipId } })).toEqual([
      expect.objectContaining({ userId: user.id, role: "OWNER", planType: "ADDON" }),
    ]);
    expect(await db.creditLedger.findMany()).toEqual([
      expect.objectContaining({
        membershipId: result.membershipId,
        userId: user.id,
        delta: 1,
        reason: "GRANT",
        actorId: user.id,
        createdAt: NOW,
      }),
    ]);
    expect(await db.payment.count({ where: { membershipId: result.membershipId } })).toBe(0);
  });

  it("allows each kind once per account", async () => {
    await trialPlans();
    const user = await createUser();

    await start(user, "GYM");
    await expectMembershipError(start(user, "GYM"), "TRIAL_ALREADY_USED");
    await start(user, "CLASS");

    vi.setSystemTime(at(2 * DAY));
    await expectMembershipError(start(user, "GYM"), "TRIAL_ALREADY_USED");
    await expectMembershipError(start(user, "CLASS", { ip: randomIp() }), "TRIAL_ALREADY_USED");
    expect(await db.trialRedemption.count()).toBe(2);
  });

  it("allows each kind once per email: a new account with an anonymized user's email can't repeat it", async () => {
    await trialPlans();
    const original = await createUser();
    await start(original, "GYM");
    await start(original, "CLASS");
    await db.user.update({
      where: { id: original.id },
      data: { email: `anonymized-${original.id}@example.invalid`, name: "Deleted user", anonymizedAt: NOW },
    });

    const newAccount = await createUser({ email: original.email });

    await expectMembershipError(start(newAccount, "GYM"), "TRIAL_ALREADY_USED");
    await expectMembershipError(start(newAccount, "CLASS"), "TRIAL_ALREADY_USED");
    await expect(start(await createUser(), "GYM", { ip: randomIp() })).resolves.toBeDefined();
  });

  it.each([
    ["a past Day Pass", () => createDayPassPlan()],
    ["a past Basic", () => createPlan()],
  ])("%s blocks the Gym Trial but not the Class Trial", async (_label, makePlan) => {
    await trialPlans();
    const user = await createUser();
    await paidMembership(user, await makePlan());

    await expectMembershipError(start(user, "GYM"), "NOT_ELIGIBLE");
    await expect(start(user, "CLASS")).resolves.toMatchObject({ kind: "CLASS" });
  });

  it("paid class history (a Class Pack) blocks the Class Trial but not the Gym Trial", async () => {
    await trialPlans();
    const user = await createUser();
    await paidMembership(user, await createClassPackPlan());

    await expectMembershipError(start(user, "CLASS"), "NOT_ELIGIBLE");
    await expect(start(user, "GYM")).resolves.toMatchObject({ kind: "GYM" });
  });

  it("counts a partner seat on a paid membership as history for both kinds", async () => {
    await trialPlans();
    const [owner, partner] = [await createUser(), await createUser()];
    const membership = await paidMembership(owner, await createCouplesPlan());
    await createSeat(membership.id, partner.id, { role: "PARTNER", joinedAt: at(-30 * DAY), endedAt: at(-10 * DAY) });

    await expectMembershipError(start(partner, "GYM"), "NOT_ELIGIBLE");
    await expectMembershipError(start(partner, "CLASS"), "NOT_ELIGIBLE");
  });

  it("doesn't count a membership whose payments were all voided", async () => {
    await trialPlans();
    const user = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    for (const plan of [await createCouplesPlan(), await createClassPackPlan()]) {
      const membership = await createOwnedMembership(user, plan, {
        createdById: admin.id,
        status: "CANCELLED",
        startsAt: at(-20 * DAY),
        currentPeriodEnd: at(10 * DAY),
      });
      await createManualPayment(membership, admin.id, { status: "VOIDED" });
    }

    await expect(start(user, "GYM")).resolves.toMatchObject({ kind: "GYM" });
    await expect(start(user, "CLASS")).resolves.toMatchObject({ kind: "CLASS" });
  });

  it("rejects a Gym Trial while an open base seat exists, and allows it once cleanup ends a lapsed one", async () => {
    await trialPlans();
    const [holder, lapsed] = [await createUser(), await createUser()];
    const unpaidPlan = await createPlan();
    await createOwnedMembership(holder, unpaidPlan, { startsAt: at(-5 * DAY), currentPeriodEnd: at(25 * DAY) });
    const old = await createOwnedMembership(lapsed, unpaidPlan, { startsAt: at(-31 * DAY), currentPeriodEnd: at(-DAY) });

    await expectMembershipError(start(holder, "GYM"), "HAS_ACTIVE_BASE");
    await expect(start(lapsed, "GYM", { ip: randomIp() })).resolves.toMatchObject({ kind: "GYM" });

    expect(await db.membership.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
      status: "EXPIRED",
      endedAt: old.currentPeriodEnd,
    });
    expect(await db.auditLog.findFirst({ where: { action: "membership.ended", targetId: old.id } })).toMatchObject({
      actorId: null,
      details: { status: "EXPIRED", via: "overdue_cleanup", trigger: "trial_start" },
    });
  });

  it("runs overdue cleanup before a Class Trial, while a lapsed paid base still blocks the Gym Trial", async () => {
    await trialPlans();
    const user = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    const lapsed = await createOwnedMembership(user, await createPlan(), {
      createdById: admin.id,
      startsAt: at(-31 * DAY),
      currentPeriodEnd: at(-DAY),
    });
    await createManualPayment(lapsed, admin.id);

    await start(user, "CLASS");

    expect(await db.membership.findUniqueOrThrow({ where: { id: lapsed.id } })).toMatchObject({ status: "EXPIRED" });
    expect(await db.membershipMember.count({ where: { membershipId: lapsed.id, endedAt: null } })).toBe(0);
    await expectMembershipError(start(user, "GYM"), "NOT_ELIGIBLE");
  });

  it("rejects a Gym Trial at closing time, on a closed day, and without opening hours, but not a Class Trial", async () => {
    await trialPlans();
    const [late, closedDay, noHours] = [await createUser(), await createUser(), await createUser()];

    vi.setSystemTime(CLOSING_TODAY);
    await expectMembershipError(start(late, "GYM"), "CLOSED_FOR_TODAY");
    expect(await db.membership.count()).toBe(0);
    await expect(start(late, "CLASS")).resolves.toMatchObject({ periodStart: CLOSING_TODAY });

    vi.setSystemTime(NOW);
    await db.openingHours.delete({ where: { weekday: WEDNESDAY } });
    await expectMembershipError(start(closedDay, "GYM", { ip: randomIp() }), "CLOSED_FOR_TODAY");

    await db.openingHours.deleteMany();
    await expectMembershipError(start(noHours, "GYM", { ip: randomIp() }), "CLOSED_FOR_TODAY");
    expect(await db.trialRedemption.count()).toBe(1);
  });

  it("rejects an unverified email, an anonymized or unknown user, and a missing or inactive trial plan", async () => {
    const unverified = await createUser({ emailVerified: false });
    const anonymized = await createUser({ anonymizedAt: at(-DAY) });
    const user = await createUser();

    await expectMembershipError(start(user, "GYM"), "TRIAL_UNAVAILABLE");
    await createGymTrialPlan({ active: false });
    await expectMembershipError(start(user, "GYM"), "TRIAL_UNAVAILABLE");

    await trialPlans();
    await expectMembershipError(start(unverified, "GYM"), "EMAIL_NOT_VERIFIED");
    await expectMembershipError(start(anonymized, "CLASS"), "USER_ANONYMIZED");
    await expectMembershipError(start({ id: randomUUID() }, "CLASS"), "USER_NOT_FOUND");
    await expect(start({ id: user.id }, "SPA" as StartTrialInput["kind"])).rejects.toBeInstanceOf(ZodError);
    expect(await db.membership.count()).toBe(0);
  });

  it("gives one trial for two concurrent starts", async () => {
    await trialPlans();
    const user = await createUser();

    const results = await Promise.allSettled([start(user, "GYM"), start(user, "GYM")]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    await expectMembershipError(Promise.reject(rejected?.reason), "TRIAL_ALREADY_USED");
    expect(await db.membership.count()).toBe(1);
    expect(await db.trialRedemption.count()).toBe(1);
  });

  it("blocks the 4th attempt per account in a day, whatever the kind, before any check", async () => {
    await trialPlans();
    const user = await createUser();

    await start(user, "GYM", { ip: randomIp() });
    await expectMembershipError(start(user, "GYM", { ip: randomIp() }), "TRIAL_ALREADY_USED");
    await expectMembershipError(start(user, "GYM", { ip: randomIp() }), "TRIAL_ALREADY_USED");
    const limited = await expectMembershipError(start(user, "CLASS", { ip: randomIp() }), "RATE_LIMITED");

    expect(limited.details?.retryAfterSeconds).toBeGreaterThan(0);
    expect(await db.trialRedemption.count({ where: { kind: "CLASS" } })).toBe(0);
  });

  it("blocks the 11th attempt from one IP in a day, across accounts", async () => {
    await trialPlans();
    const users = [];
    for (let i = 0; i < 11; i++) users.push(await createUser());

    for (const user of users.slice(0, 10)) await start(user, "CLASS");
    await expectMembershipError(start(users[10], "CLASS"), "RATE_LIMITED");
    await expect(start(users[10], "CLASS", { ip: randomIp() })).resolves.toMatchObject({ kind: "CLASS" });
    expect(await db.trialRedemption.count()).toBe(11);
  });

  it("puts requests without a client IP in one shared bucket, like the auth limits", () => {
    expect(trialIpIdentifier(null)).toBe("no-ip");
    expect(trialIpIdentifier("203.0.113.7")).toBe("203.0.113.7");
  });
});

describe("trialEligibility", () => {
  it("offers both trials to a new member, with when each would end", async () => {
    const { gym, cls } = await trialPlans();
    const user = await createUser();

    expect(await trialEligibility(user.id)).toEqual({
      GYM: { eligible: true, planId: gym.id, planName: "Gym Trial", endsAt: CLOSING_TODAY },
      CLASS: { eligible: true, planId: cls.id, planName: "Class Trial", endsAt: SEVEN_DAYS_LATER },
    });
  });

  it("gives the reason a trial can't start", async () => {
    const user = await createUser();
    expect(await trialEligibility(user.id)).toEqual({
      GYM: { eligible: false, reason: "TRIAL_UNAVAILABLE" },
      CLASS: { eligible: false, reason: "TRIAL_UNAVAILABLE" },
    });

    await trialPlans();
    const unverified = await createUser({ emailVerified: false });
    expect((await trialEligibility(unverified.id)).GYM).toEqual({ eligible: false, reason: "EMAIL_NOT_VERIFIED" });

    await start(user, "GYM");
    await paidMembership(user, await createClassPackPlan(), true);
    expect(await trialEligibility(user.id)).toEqual({
      GYM: { eligible: false, reason: "TRIAL_ALREADY_USED" },
      CLASS: { eligible: false, reason: "NOT_ELIGIBLE" },
    });

    const holder = await createUser();
    await createOwnedMembership(holder, await createPlan(), { startsAt: at(-5 * DAY), currentPeriodEnd: at(25 * DAY) });
    expect((await trialEligibility(holder.id)).GYM).toEqual({ eligible: false, reason: "HAS_ACTIVE_BASE" });

    vi.setSystemTime(CLOSING_TODAY);
    expect((await trialEligibility((await createUser()).id)).GYM).toEqual({ eligible: false, reason: "CLOSED_FOR_TODAY" });
  });

  it("ignores an overdue base that cleanup would end, and writes nothing", async () => {
    await trialPlans();
    const user = await createUser();
    const lapsed = await createOwnedMembership(user, await createPlan(), { startsAt: at(-31 * DAY), currentPeriodEnd: at(-DAY) });

    expect((await trialEligibility(user.id)).GYM).toMatchObject({ eligible: true });
    expect(await db.membership.findUniqueOrThrow({ where: { id: lapsed.id } })).toMatchObject({ status: "ACTIVE", endedAt: null });
    expect(await db.auditLog.count()).toBe(0);
  });

  it("rejects an unknown or anonymized user", async () => {
    await expectMembershipError(trialEligibility(randomUUID()), "USER_NOT_FOUND");
    await expectMembershipError(trialEligibility((await createUser({ anonymizedAt: NOW })).id), "USER_ANONYMIZED");
  });
});
