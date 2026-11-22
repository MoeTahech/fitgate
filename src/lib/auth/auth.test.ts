import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/auth/[...all]/route";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { resetDatabase } from "../../../tests/support/database";
import { deleteMessages, readMessageText, waitForMessages } from "../../../tests/support/mailpit";

const PASSWORD = "correct horse battery";
const createdEmails: string[] = [];

function randomIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

function uniqueEmail(): string {
  const email = `auth-${randomUUID()}@example.test`;
  createdEmails.push(email);
  return email;
}

function post(path: string, body: Record<string, unknown>, ip = randomIp()): Promise<Response> {
  return POST(
    new Request(`${env.BETTER_AUTH_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: env.BETTER_AUTH_URL, "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await Promise.all(createdEmails.map((email) => deleteMessages(email)));
});

describe("sign-up", () => {
  it("creates an unverified MEMBER with a lowercase email and emails a verification link", async () => {
    const email = uniqueEmail();
    const response = await post("/sign-up/email", { name: "Sam", email: email.toUpperCase(), password: PASSWORD });
    expect(response.status).toBe(200);

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ role: "MEMBER", emailVerified: false });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);

    const [message] = await waitForMessages(email);
    expect(message?.Subject).toMatch(/verify/i);
    expect(await readMessageText(message.ID)).toMatch(/\/api\/auth\/verify-email\?token=/);
  });

  it("ignores a client-supplied role", async () => {
    const email = uniqueEmail();
    const response = await post("/sign-up/email", { name: "Eve", email, password: PASSWORD, role: "ADMIN" });
    expect(response.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { email } })).role).toBe("MEMBER");
  });

  it("answers an existing email like a new one and notifies the owner", async () => {
    const email = uniqueEmail();
    const first = await post("/sign-up/email", { name: "Sam", email, password: PASSWORD });
    await waitForMessages(email, 1);

    const second = await post("/sign-up/email", { name: "Other", email, password: `${PASSWORD}!` });
    expect(second.status).toBe(first.status);
    const shape = (body: unknown) => Object.keys((body as { user?: object }).user ?? {}).sort();
    expect(shape(await second.json())).toEqual(shape(await first.json()));

    const messages = await waitForMessages(email, 2);
    expect(messages.map((m) => m.Subject)).toEqual(
      expect.arrayContaining([expect.stringMatching(/already have/i)]),
    );
    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  it("rejects names that are empty or too long", async () => {
    for (const name of ["   ", "x".repeat(101)]) {
      const email = uniqueEmail();
      expect((await post("/sign-up/email", { name, email, password: PASSWORD })).status).toBe(400);
      expect(await db.user.findUnique({ where: { email } })).toBeNull();
    }
  });

  it("rejects passwords shorter than 10 characters", async () => {
    const response = await post("/sign-up/email", { name: "Sam", email: uniqueEmail(), password: "short-pw" });
    expect(response.status).toBe(400);
  });
});

describe("sign-in", () => {
  it("refuses unverified users", async () => {
    const email = uniqueEmail();
    await post("/sign-up/email", { name: "Sam", email, password: PASSWORD });
    const response = await post("/sign-in/email", { email, password: PASSWORD });
    expect(response.status).toBe(403);
  });

  it("limits attempts per IP and email with a Retry-After header", async () => {
    const ip = randomIp();
    const email = uniqueEmail();
    const statuses: number[] = [];
    let limited: Response | undefined;
    for (let i = 0; i < 6; i++) {
      const response = await post("/sign-in/email", { email, password: "wrong password!" }, ip);
      statuses.push(response.status);
      if (response.status === 429) limited = response;
    }
    expect(statuses.slice(0, 5).every((status) => status === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
    expect(Number(limited?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("password reset", () => {
  it("stores the token hashed, revokes sessions, and is single use", async () => {
    const email = uniqueEmail();
    await post("/sign-up/email", { name: "Sam", email, password: PASSWORD });
    await db.user.update({ where: { email }, data: { emailVerified: true } });
    expect((await post("/sign-in/email", { email, password: PASSWORD })).status).toBe(200);
    const { id: userId } = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await db.session.count({ where: { userId } })).toBe(1);

    const requested = await post("/request-password-reset", { email, redirectTo: "/reset-password" });
    expect(requested.status).toBe(200);
    const messages = await waitForMessages(email, 2);
    const reset = messages.find((m) => /reset your/i.test(m.Subject));
    expect(reset).toBeDefined();
    const token = /\/reset-password\/([^?\s]+)/.exec(await readMessageText(reset!.ID))?.[1];
    expect(token).toBeTruthy();

    const rows = await db.verification.findMany();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.identifier).not.toContain(token!);
      expect(row.value).not.toContain(token!);
    }

    const newPassword = `${PASSWORD} renewed`;
    expect((await post("/reset-password", { token, newPassword })).status).toBe(200);
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect((await post("/reset-password", { token, newPassword: `${newPassword}!` })).status).toBe(400);
    expect((await post("/sign-in/email", { email, password: newPassword })).status).toBe(200);
  });
});

describe("per-IP limits", () => {
  it("limits sign-ups per IP and adds Retry-After", async () => {
    const ip = randomIp();
    const statuses: number[] = [];
    let limited: Response | undefined;
    for (let i = 0; i < 6; i++) {
      const response = await post("/sign-up/email", { name: "Sam", email: uniqueEmail(), password: PASSWORD }, ip);
      statuses.push(response.status);
      if (response.status === 429) limited = response;
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(Number(limited?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
