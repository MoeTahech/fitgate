import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { InviteStatus, Prisma, TrialKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { resetDatabase } from "../support/database";
import { createFreeze, createMembership, createPlan, createUser } from "../support/factories";

const DAY_MS = 24 * 60 * 60 * 1000;

const gymTrial = {
  type: "BASE",
  openAccess: true,
  classAccess: "NONE",
  billing: "ONE_TIME",
  intervalMonths: null,
  durationMode: "CALENDAR_DAYS",
  durationDays: 1,
  priceCents: 0,
  trialKind: "GYM",
} satisfies Partial<Prisma.PlanUncheckedCreateInput>;

const classTrial = {
  type: "ADDON",
  openAccess: false,
  classAccess: "CREDITS",
  credits: 1,
  billing: "ONE_TIME",
  intervalMonths: null,
  durationMode: "ROLLING",
  durationDays: 7,
  priceCents: 0,
  trialKind: "CLASS",
} satisfies Partial<Prisma.PlanUncheckedCreateInput>;

const oneTime = {
  billing: "ONE_TIME",
  intervalMonths: null,
  durationDays: 1,
} satisfies Partial<Prisma.PlanUncheckedCreateInput>;

beforeEach(async () => {
  await resetDatabase();
});

describe("plans duration mode", () => {
  it("requires a duration mode exactly for one-time plans", async () => {
    await expect(createPlan({ ...oneTime })).rejects.toThrow(/plans_duration_mode_check/);
    await expect(createPlan({ durationMode: "ROLLING" })).rejects.toThrow(/plans_duration_mode_check/);
    await expect(createPlan({ ...oneTime, durationMode: "ROLLING" })).resolves.toBeDefined();
    await expect(createPlan()).resolves.toBeDefined();
  });

  it("limits calendar-day plans to one day", async () => {
    await expect(
      createPlan({ ...oneTime, durationMode: "CALENDAR_DAYS", durationDays: 2 }),
    ).rejects.toThrow(/plans_calendar_days_check/);
    await expect(
      createPlan({ ...oneTime, durationMode: "CALENDAR_DAYS", durationDays: 1 }),
    ).resolves.toBeDefined();
    await expect(
      createPlan({ ...oneTime, durationMode: "ROLLING", durationDays: 60 }),
    ).resolves.toBeDefined();
  });
});

describe("plans trial shape", () => {
  it("accepts the Gym Trial and Class Trial shapes", async () => {
    await expect(createPlan(gymTrial)).resolves.toBeDefined();
    await expect(createPlan(classTrial)).resolves.toBeDefined();
  });

  it.each<[string, Partial<Prisma.PlanUncheckedCreateInput>]>([
    ["a price", { priceCents: 100 }],
    ["recurring billing", { billing: "RECURRING", intervalMonths: 1, durationDays: null, durationMode: null }],
    ["a Stripe price", { stripePriceId: "price_test" }],
    ["a Stripe product", { stripeProductId: "prod_test" }],
    ["two members", { maxMembers: 2 }],
    ["the ADDON type", { type: "ADDON" }],
    ["no open access", { openAccess: false }],
    ["class credits", { classAccess: "CREDITS", credits: 1 }],
    ["rolling duration", { durationMode: "ROLLING" }],
  ])("rejects a Gym Trial with %s", async (_label, change) => {
    await expect(createPlan({ ...gymTrial, ...change })).rejects.toThrow(/plans_trial_shape_check/);
  });

  it.each<[string, Partial<Prisma.PlanUncheckedCreateInput>]>([
    ["a price", { priceCents: 100 }],
    ["a Stripe price", { stripePriceId: "price_test" }],
    ["the BASE type", { type: "BASE" }],
    ["open access", { openAccess: true }],
    ["unlimited classes", { classAccess: "UNLIMITED", credits: null }],
    ["two credits", { credits: 2 }],
    ["a calendar-day duration", { durationMode: "CALENDAR_DAYS", durationDays: 1 }],
    ["a 6-day duration", { durationDays: 6 }],
    ["an 8-day duration", { durationDays: 8 }],
  ])("rejects a Class Trial with %s", async (_label, change) => {
    await expect(createPlan({ ...classTrial, ...change })).rejects.toThrow(/plans_trial_shape_check/);
  });

  it("allows one active trial plan per kind", async () => {
    await createPlan(gymTrial);
    await expect(createPlan(gymTrial)).rejects.toThrow(/Unique constraint failed/);
    await expect(createPlan({ ...gymTrial, active: false })).resolves.toBeDefined();
    await expect(createPlan(classTrial)).resolves.toBeDefined();
    await expect(createPlan(classTrial)).rejects.toThrow(/Unique constraint failed/);
  });
});

describe("trial_redemptions", () => {
  async function redeem(values: {
    userId: string;
    kind: TrialKind;
    emailHash?: string;
    phoneHash?: string | null;
  }) {
    const plan = await db.plan.findFirst({ where: { trialKind: values.kind } });
    const planId = plan?.id ?? (await createPlan(values.kind === "GYM" ? gymTrial : classTrial)).id;
    const membership = await createMembership(values.userId, planId, { source: "TRIAL" });
    return db.trialRedemption.create({
      data: {
        userId: values.userId,
        membershipId: membership.id,
        kind: values.kind,
        emailHash: values.emailHash ?? randomBytes(32).toString("hex"),
        phoneHash: values.phoneHash ?? null,
      },
    });
  }

  it("allows each kind once per user", async () => {
    const user = await createUser();
    await redeem({ userId: user.id, kind: "GYM" });
    await expect(redeem({ userId: user.id, kind: "GYM" })).rejects.toThrow(/Unique constraint failed/);
    await expect(redeem({ userId: user.id, kind: "CLASS" })).resolves.toBeDefined();
  });

  it("allows each kind once per email hash", async () => {
    const emailHash = randomBytes(32).toString("hex");
    await redeem({ userId: (await createUser()).id, kind: "GYM", emailHash });
    await expect(
      redeem({ userId: (await createUser()).id, kind: "GYM", emailHash }),
    ).rejects.toThrow(/Unique constraint failed/);
    await expect(
      redeem({ userId: (await createUser()).id, kind: "CLASS", emailHash }),
    ).resolves.toBeDefined();
  });

  it("allows each kind once per phone hash, and any number without a phone", async () => {
    const phoneHash = randomBytes(32).toString("hex");
    await redeem({ userId: (await createUser()).id, kind: "CLASS", phoneHash });
    await expect(
      redeem({ userId: (await createUser()).id, kind: "CLASS", phoneHash }),
    ).rejects.toThrow(/Unique constraint failed/);
    await expect(
      redeem({ userId: (await createUser()).id, kind: "GYM", phoneHash }),
    ).resolves.toBeDefined();
    await redeem({ userId: (await createUser()).id, kind: "CLASS" });
    await expect(redeem({ userId: (await createUser()).id, kind: "CLASS" })).resolves.toBeDefined();
  });
});

describe("membership_invites", () => {
  async function insertInvite(values: {
    status?: InviteStatus;
    revokedAt?: Date | null;
    revokedById?: string | null;
    createdAt?: Date;
    expiresAt?: Date;
  }) {
    const owner = await createUser();
    const plan = await createPlan({ maxMembers: 2 });
    const membership = await createMembership(owner.id, plan.id);
    const createdAt = values.createdAt ?? new Date();
    return db.membershipInvite.create({
      data: {
        membershipId: membership.id,
        email: "partner@example.test",
        tokenHash: randomBytes(32).toString("hex"),
        invitedById: owner.id,
        status: values.status ?? "PENDING",
        revokedAt: values.revokedAt ?? null,
        revokedById: values.revokedById ?? null,
        createdAt,
        expiresAt: values.expiresAt ?? new Date(createdAt.getTime() + 7 * DAY_MS),
      },
    });
  }

  it("requires a revocation time exactly when REVOKED", async () => {
    await expect(insertInvite({ status: "REVOKED" })).rejects.toThrow(/membership_invites_revoked_check/);
    await expect(insertInvite({ revokedAt: new Date() })).rejects.toThrow(/membership_invites_revoked_check/);
  });

  it("allows a revocation by a user or by the system", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await expect(
      insertInvite({ status: "REVOKED", revokedAt: new Date(), revokedById: admin.id }),
    ).resolves.toBeDefined();
    await expect(insertInvite({ status: "REVOKED", revokedAt: new Date() })).resolves.toBeDefined();
  });

  it("rejects a revoker without a revocation time", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await expect(insertInvite({ revokedById: admin.id })).rejects.toThrow(/membership_invites_revoked_by_check/);
  });

  it("rejects an expiry that is not after creation", async () => {
    const createdAt = new Date();
    await expect(insertInvite({ createdAt, expiresAt: createdAt })).rejects.toThrow(/membership_invites_expiry_check/);
    await expect(
      insertInvite({ createdAt, expiresAt: new Date(createdAt.getTime() + 1) }),
    ).resolves.toBeDefined();
  });
});

describe("membership_freezes", () => {
  const HOUR_MS = 60 * 60 * 1000;

  async function insertFreeze(startsAt: Date, endsAt: Date) {
    const owner = await createUser();
    const membership = await createMembership(owner.id, (await createPlan()).id);
    return createFreeze(membership.id, owner.id, { startsAt, endsAt });
  }

  it("requires the end after the start", async () => {
    const startsAt = new Date("2027-10-14T21:00:00.000Z");
    await expect(insertFreeze(startsAt, startsAt)).rejects.toThrow(/membership_freezes_range_check/);
    await expect(insertFreeze(startsAt, new Date(startsAt.getTime() + 1))).resolves.toBeDefined();
  });

  it("allows up to 30 days 1 hour, the length of 30 local days across a DST end", async () => {
    // 15 Oct to 13 Nov 2027 in Beirut: midnight UTC+3 to midnight UTC+2 after the 31 Oct change.
    const startsAt = new Date("2027-10-14T21:00:00.000Z");
    const endsAt = new Date("2027-11-13T22:00:00.000Z");
    expect(endsAt.getTime() - startsAt.getTime()).toBe(30 * DAY_MS + HOUR_MS);

    await expect(insertFreeze(startsAt, endsAt)).resolves.toBeDefined();
    await expect(insertFreeze(startsAt, new Date(endsAt.getTime() + 1))).rejects.toThrow(/membership_freezes_range_check/);
  });
});
