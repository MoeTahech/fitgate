import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { signUpSchema } from "@/lib/auth/schemas";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db";

export type BootstrapErrorCode = "ADMIN_EXISTS" | "EMAIL_TAKEN";

export class BootstrapError extends Error {
  readonly code: BootstrapErrorCode;

  constructor(code: BootstrapErrorCode) {
    super(code === "ADMIN_EXISTS" ? "An admin already exists" : "A user with this email already exists");
    this.name = "BootstrapError";
    this.code = code;
  }
}

/**
 * Creates the first admin: a verified user with a Better Auth credential account, in one
 * transaction with its audit row. Refuses once any active admin exists.
 */
export async function bootstrapAdmin(input: z.input<typeof signUpSchema>): Promise<{ userId: string; email: string }> {
  const { name, email, password } = signUpSchema.parse(input);
  const context = await auth.$context;
  const passwordHash = await context.password.hash(password);
  const userId = context.generateId({ model: "user" }) || randomUUID();
  const accountId = context.generateId({ model: "account" }) || randomUUID();

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('fitgate:bootstrap-admin', 0))`;
    if ((await tx.user.count({ where: { role: "ADMIN", anonymizedAt: null } })) > 0) {
      throw new BootstrapError("ADMIN_EXISTS");
    }
    if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new BootstrapError("EMAIL_TAKEN");
    }

    await tx.user.create({ data: { id: userId, name, email, emailVerified: true, role: "ADMIN" } });
    await tx.account.create({
      data: { id: accountId, userId, providerId: "credential", accountId: userId, password: passwordHash },
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: "user.role_changed",
        targetType: "user",
        targetId: userId,
        details: { from: "MEMBER", to: "ADMIN", via: "bootstrap" },
      },
    });
    return { userId, email };
  });
}
