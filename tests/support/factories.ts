import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/client";

export async function createUser(overrides: { role?: Role; email?: string; name?: string } = {}) {
  const id = randomUUID();
  return db.user.create({
    data: {
      id,
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `user-${id}@example.test`,
      emailVerified: true,
      role: overrides.role ?? "MEMBER",
    },
  });
}
