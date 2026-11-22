import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Role, SessionStatus } from "@/generated/prisma/client";

const HOUR_MS = 60 * 60 * 1000;

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
