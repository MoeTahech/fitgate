import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/auth/[...all]/route";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { resetDatabase } from "../../../tests/support/database";
import { createUser } from "../../../tests/support/factories";
import { bootstrapAdmin, BootstrapError } from "./bootstrap-admin";

const PASSWORD = "bootstrap admin password";

beforeEach(async () => {
  await resetDatabase();
});

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BootstrapError);
  return (error as BootstrapError).code;
}

describe("bootstrapAdmin", () => {
  it("creates a verified admin who can sign in, with a bootstrap audit row", async () => {
    const { userId, email } = await bootstrapAdmin({ name: "Owner", email: "Owner@Example.test", password: PASSWORD });

    expect(email).toBe("owner@example.test");
    expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
      role: "ADMIN",
      emailVerified: true,
    });
    const audit = await db.auditLog.findFirstOrThrow();
    expect(audit).toMatchObject({ actorId: null, action: "user.role_changed", targetId: userId });
    expect(audit.details).toEqual({ from: "MEMBER", to: "ADMIN", via: "bootstrap" });

    const response = await POST(
      new Request(`${env.BETTER_AUTH_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: env.BETTER_AUTH_URL, "x-forwarded-for": "10.200.0.1" },
        body: JSON.stringify({ email, password: PASSWORD }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it("refuses once an active admin exists", async () => {
    await createUser({ role: "ADMIN" });
    expect(await codeOf(bootstrapAdmin({ name: "Owner", email: "owner@example.test", password: PASSWORD }))).toBe(
      "ADMIN_EXISTS",
    );
  });

  it("refuses an email that is already registered", async () => {
    const member = await createUser();
    expect(await codeOf(bootstrapAdmin({ name: "Owner", email: member.email, password: PASSWORD }))).toBe("EMAIL_TAKEN");
    expect(await db.user.count({ where: { role: "ADMIN" } })).toBe(0);
  });

  it("creates only one admin when run concurrently", async () => {
    const results = await Promise.allSettled([
      bootstrapAdmin({ name: "A", email: "a@example.test", password: PASSWORD }),
      bootstrapAdmin({ name: "B", email: "b@example.test", password: PASSWORD }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("validates input", async () => {
    await expect(bootstrapAdmin({ name: "Owner", email: "not-an-email", password: PASSWORD })).rejects.toThrow();
    await expect(bootstrapAdmin({ name: "Owner", email: "owner@example.test", password: "short" })).rejects.toThrow();
  });
});
