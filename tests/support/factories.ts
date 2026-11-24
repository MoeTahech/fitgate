import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type {
  MembershipSource,
  MembershipStatus,
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
