import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type {
  FreezeStatus,
  MemberRole,
  Membership,
  MembershipSource,
  MembershipStatus,
  PaymentMethod,
  PlanType,
  Prisma,
  Role,
  SessionStatus,
} from "@/generated/prisma/client";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export async function createUser(
  overrides: { role?: Role; email?: string; name?: string; emailVerified?: boolean; anonymizedAt?: Date | null } = {},
) {
  const id = randomUUID();
  return db.user.create({
    data: {
      id,
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `user-${id}@example.test`,
      emailVerified: overrides.emailVerified ?? true,
      role: overrides.role ?? "MEMBER",
      anonymizedAt: overrides.anonymizedAt ?? null,
    },
  });
}

export async function createSession(userId: string) {
  return db.session.create({
    data: {
      id: randomUUID(),
      token: randomBytes(32).toString("base64url"),
      userId,
      expiresAt: new Date(Date.now() + 7 * 24 * HOUR_MS),
    },
  });
}

export async function createClassTemplate(trainerId: string, overrides: { active?: boolean } = {}) {
  return db.classTemplate.create({
    data: {
      name: "Strength",
      trainerId,
      capacity: 12,
      durationMin: 60,
      weekdays: [1, 3],
      startMinLocal: 18 * 60,
      validFrom: new Date(Date.now() - 30 * 24 * HOUR_MS),
      active: overrides.active ?? true,
    },
  });
}

export async function createClassSession(
  templateId: string,
  trainerId: string,
  overrides: { startsAt?: Date; status?: SessionStatus } = {},
) {
  const startsAt = overrides.startsAt ?? new Date(Date.now() + 24 * HOUR_MS);
  const status = overrides.status ?? "SCHEDULED";
  return db.classSession.create({
    data: {
      templateId,
      trainerId,
      name: "Strength",
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR_MS),
      capacity: 12,
      status,
      cancelledAt: status === "CANCELLED" ? new Date() : null,
    },
  });
}

export async function createPlan(overrides: Partial<Prisma.PlanUncheckedCreateInput> = {}) {
  return db.plan.create({
    data: {
      slug: `plan-${randomUUID()}`,
      name: "Test Plan",
      type: "BASE",
      openAccess: true,
      classAccess: "NONE",
      billing: "RECURRING",
      intervalMonths: 1,
      priceCents: 3000,
      ...overrides,
    },
  });
}

export async function createMembership(
  ownerId: string,
  planId: string,
  overrides: {
    source?: MembershipSource;
    status?: MembershipStatus;
    createdById?: string | null;
    startsAt?: Date;
    currentPeriodEnd?: Date;
  } = {},
) {
  const source = overrides.source ?? "MANUAL";
  const status = overrides.status ?? "ACTIVE";
  const startsAt = overrides.startsAt ?? new Date();
  const ended = status === "CANCELLED" || status === "EXPIRED";
  return db.membership.create({
    data: {
      ownerId,
      planId,
      source,
      status,
      createdById: overrides.createdById !== undefined ? overrides.createdById : source === "MANUAL" ? ownerId : null,
      startsAt,
      currentPeriodStart: startsAt,
      currentPeriodEnd: overrides.currentPeriodEnd ?? new Date(startsAt.getTime() + 30 * DAY_MS),
      endedAt: ended ? new Date() : null,
      pastDueSince: status === "PAST_DUE" ? new Date() : null,
      createdAt: startsAt,
    },
  });
}

export async function createSeat(
  membershipId: string,
  userId: string,
  overrides: { role?: MemberRole; planType?: PlanType; joinedAt?: Date; endedAt?: Date | null } = {},
) {
  return db.membershipMember.create({
    data: {
      membershipId,
      userId,
      role: overrides.role ?? "OWNER",
      planType: overrides.planType ?? "BASE",
      joinedAt: overrides.joinedAt ?? new Date(),
      endedAt: overrides.endedAt ?? null,
    },
  });
}

export async function createManualPayment(
  membership: Pick<Membership, "id" | "ownerId" | "currentPeriodStart" | "currentPeriodEnd">,
  recordedById: string,
  overrides: { status?: "SUCCEEDED" | "VOIDED"; method?: Exclude<PaymentMethod, "STRIPE">; reference?: string | null; amountCents?: number } = {},
) {
  const status = overrides.status ?? "SUCCEEDED";
  const voided = status === "VOIDED";
  return db.payment.create({
    data: {
      membershipId: membership.id,
      userId: membership.ownerId,
      method: overrides.method ?? "CASH",
      status,
      amountCents: overrides.amountCents ?? 3000,
      periodStart: membership.currentPeriodStart,
      periodEnd: membership.currentPeriodEnd,
      paidAt: membership.currentPeriodStart,
      reference: overrides.reference ?? null,
      recordedById,
      voidedAt: voided ? new Date() : null,
      voidedById: voided ? recordedById : null,
      voidReason: voided ? "Recorded by mistake" : null,
    },
  });
}

export async function createMembershipInvite(
  membershipId: string,
  invitedById: string,
  overrides: { email?: string; createdAt?: Date; expiresAt?: Date } = {},
) {
  const createdAt = overrides.createdAt ?? new Date();
  return db.membershipInvite.create({
    data: {
      membershipId,
      invitedById,
      email: overrides.email ?? `partner-${randomUUID()}@example.test`,
      tokenHash: randomBytes(32).toString("hex"),
      createdAt,
      expiresAt: overrides.expiresAt ?? new Date(createdAt.getTime() + 7 * DAY_MS),
    },
  });
}

export async function createFreeze(
  membershipId: string,
  requestedById: string,
  overrides: { status?: FreezeStatus; startsAt?: Date; endsAt?: Date; decidedById?: string } = {},
) {
  const status = overrides.status ?? "REQUESTED";
  const startsAt = overrides.startsAt ?? new Date(Date.now() + 2 * DAY_MS);
  const decided = status === "APPROVED" || status === "REJECTED" || status === "COMPLETED";
  return db.membershipFreeze.create({
    data: {
      membershipId,
      requestedById,
      status,
      startsAt,
      endsAt: overrides.endsAt ?? new Date(startsAt.getTime() + 7 * DAY_MS),
      decidedById: decided ? (overrides.decidedById ?? requestedById) : null,
      decidedAt: decided ? new Date() : null,
    },
  });
}

const oneTimePlan = { billing: "ONE_TIME", intervalMonths: null } as const;

export function createDayPassPlan(overrides: Partial<Prisma.PlanUncheckedCreateInput> = {}) {
  return createPlan({ ...oneTimePlan, durationDays: 1, durationMode: "CALENDAR_DAYS", priceCents: 1000, ...overrides });
}

export function createGymTrialPlan(overrides: Partial<Prisma.PlanUncheckedCreateInput> = {}) {
  return createPlan({ ...oneTimePlan, durationDays: 1, durationMode: "CALENDAR_DAYS", priceCents: 0, trialKind: "GYM", ...overrides });
}

export function createClassPackPlan(overrides: Partial<Prisma.PlanUncheckedCreateInput> = {}) {
  return createPlan({
    ...oneTimePlan,
    type: "ADDON",
    openAccess: false,
    classAccess: "CREDITS",
    credits: 10,
    durationDays: 60,
    durationMode: "ROLLING",
    priceCents: 7000,
    ...overrides,
  });
}

export function createCouplesPlan(overrides: Partial<Prisma.PlanUncheckedCreateInput> = {}) {
  return createPlan({ maxMembers: 2, classAccess: "UNLIMITED", priceCents: 8500, ...overrides });
}

/** A membership with its owner's seat (ended with the membership). */
export async function createOwnedMembership(
  owner: { id: string },
  plan: { id: string; type: PlanType },
  overrides: Parameters<typeof createMembership>[2] = {},
) {
  const membership = await createMembership(owner.id, plan.id, overrides);
  await createSeat(membership.id, owner.id, { planType: plan.type, joinedAt: membership.startsAt, endedAt: membership.endedAt });
  return membership;
}
