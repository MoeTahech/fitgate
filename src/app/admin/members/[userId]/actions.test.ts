import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/memberships-ui/forms";
import { AUTH_ERROR_MESSAGES, membershipErrorResult } from "@/lib/memberships-ui/messages";
import { resetDatabase } from "../../../../../tests/support/database";
import {
  createCouplesPlan,
  createGymTrialPlan,
  createManualPayment,
  createOwnedMembership,
  createPlan,
  createSeat,
  createUser,
} from "../../../../../tests/support/factories";
import { recordPaymentAction } from "./actions";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
const request = vi.hoisted(() => ({ ip: null as string | null }));
const cache = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/lib/auth/session", async () => {
  const guards = await import("@/lib/auth/guards");
  return { ...guards, ...guards.createGuards(async () => session.user) };
});

vi.mock("next/cache", () => ({ refresh: cache.refresh }));

vi.mock("@/lib/request-ip", () => ({
  getRequestIp: async () => request.ip,
  getRequestIpHash: async () => (request.ip ? `hash:${request.ip}` : null),
}));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Wednesday 2 December 2026, 10:00 in Beirut (UTC+2). The gym is open 06:00-22:00 every day.
const NOW = new Date("2026-12-02T08:00:00.000Z");
const IDLE: ActionResult = { status: "idle" };

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  request.ip = `test-ip-${randomUUID()}`;
  await resetDatabase();
  await db.gymSettings.create({ data: { id: 1, name: "Gym", timeZone: "Asia/Beirut", capacity: 50 } });
  await db.openingHours.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAtMin: 360, closesAtMin: 1320 })),
  });
});

afterEach(() => {
  session.user = null;
  vi.clearAllMocks();
  vi.useRealTimers();
});

function signInAs(user: { id: string; name: string; email: string; role: Role }) {
  session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function signedInAdmin() {
  const admin = await createUser({ role: "ADMIN", name: "Front Desk" });
  signInAs(admin);
  return admin;
}

/** A member holding a running front-desk Basic membership (5 days ago to 25 days ahead). */
async function memberWithBasic() {
  const member = await createUser({ name: "Sam Member" });
  const basic = await createPlan({ name: "Basic", priceCents: 3000 });
  const membership = await createOwnedMembership(member, basic, { startsAt: at(-5 * DAY), currentPeriodEnd: at(25 * DAY) });
  return { member, basic, membership };
}

describe("recordPaymentAction", () => {
  it("records the plan's price, starts the membership, and refreshes the page", async () => {
    const admin = await signedInAdmin();
    const member = await createUser();
    const premium = await createPlan({ name: "Premium", priceCents: 5000 });

    const result = await recordPaymentAction(
      IDLE,
      form({ userId: member.id, planId: premium.id, method: "CASH", reference: " R-100 ", note: "Paid at the desk" }),
    );

    expect(result).toEqual({ status: "success", message: "Payment recorded. The membership has started." });
    const membership = await db.membership.findFirstOrThrow({ where: { ownerId: member.id } });
    expect(membership).toMatchObject({ planId: premium.id, source: "MANUAL", status: "ACTIVE", createdById: admin.id, startsAt: NOW });
    const payment = await db.payment.findFirstOrThrow({ where: { membershipId: membership.id } });
    expect(payment).toMatchObject({
      amountCents: 5000,
      currency: premium.currency,
      method: "CASH",
      reference: "R-100",
      note: "Paid at the desk",
      recordedById: admin.id,
      status: "SUCCEEDED",
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "payment.recorded" } });
    expect(audit.ipHash).toBe(`hash:${request.ip}`);
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores an amount sent with the form", async () => {
    await signedInAdmin();
    const member = await createUser();
    const basic = await createPlan({ priceCents: 3000 });

    const data = form({ userId: member.id, planId: basic.id, method: "CASH" });
    data.set("amountCents", "1");
    await recordPaymentAction(IDLE, data);

    expect(await db.payment.findFirstOrThrow({ where: { userId: member.id } })).toMatchObject({ amountCents: 3000 });
  });

  it("supersedes a running Gym Trial without asking", async () => {
    await signedInAdmin();
    const member = await createUser();
    const trialPlan = await createGymTrialPlan({ name: "Gym Trial" });
    const trial = await createOwnedMembership(member, trialPlan, { source: "TRIAL", startsAt: at(-HOUR), currentPeriodEnd: at(10 * HOUR) });
    const basic = await createPlan({ name: "Basic" });

    const result = await recordPaymentAction(IDLE, form({ userId: member.id, planId: basic.id, method: "CASH" }));

    expect(result).toEqual({ status: "success", message: expect.stringContaining("trial has ended") });
    expect(await db.membership.findUniqueOrThrow({ where: { id: trial.id } })).toMatchObject({ status: "CANCELLED", endedAt: NOW });
  });

  it("refuses an unconfirmed switch with the days it loses, changes nothing, and refreshes the options", async () => {
    await signedInAdmin();
    const { member, membership } = await memberWithBasic();
    const premium = await createPlan({ name: "Premium", priceCents: 5000 });

    const result = await recordPaymentAction(IDLE, form({ userId: member.id, planId: premium.id, method: "CASH" }));

    expect(result).toEqual(
      membershipErrorResult(
        { code: "HAS_ACTIVE_BASE", details: { reason: "SWITCH_NEEDS_CONFIRMATION", remainingDays: 25, hasPartner: false } },
        "admin",
      ),
    );
    expect(result.message).toContain("25 days left will be lost");
    expect(await db.payment.count()).toBe(0);
    expect(await db.membership.count({ where: { ownerId: member.id } })).toBe(1);
    expect(await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({
      status: "ACTIVE",
      currentPeriodEnd: membership.currentPeriodEnd,
      endedAt: null,
    });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("names the partner in the switch copy", async () => {
    await signedInAdmin();
    const member = await createUser();
    const couples = await createCouplesPlan({ name: "Couples Basic" });
    const membership = await createOwnedMembership(member, couples, { startsAt: at(-5 * DAY), currentPeriodEnd: at(25 * DAY) });
    await createSeat(membership.id, (await createUser()).id, { role: "PARTNER", joinedAt: at(-DAY) });
    const premium = await createPlan({ name: "Premium" });

    const result = await recordPaymentAction(IDLE, form({ userId: member.id, planId: premium.id, method: "CASH" }));

    expect(result.message).toContain("The partner will be removed.");
  });

  it("switches when the dialog's confirm sends confirmSwitch", async () => {
    await signedInAdmin();
    const { member, membership } = await memberWithBasic();
    const premium = await createPlan({ name: "Premium", priceCents: 5000 });

    const result = await recordPaymentAction(
      IDLE,
      form({ userId: member.id, planId: premium.id, method: "CASH", confirmSwitch: "true" }),
    );

    expect(result).toEqual({ status: "success", message: expect.stringContaining("previous membership has ended") });
    expect(await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({ status: "CANCELLED", endedAt: NOW });
    const next = await db.membership.findFirstOrThrow({ where: { ownerId: member.id, planId: premium.id } });
    expect(await db.payment.findFirstOrThrow({ where: { membershipId: next.id } })).toMatchObject({ amountCents: 5000 });
  });

  it("treats any other confirmSwitch value as a stale page", async () => {
    await signedInAdmin();
    const { member } = await memberWithBasic();
    const premium = await createPlan({ name: "Premium" });

    const result = await recordPaymentAction(
      IDLE,
      form({ userId: member.id, planId: premium.id, method: "CASH", confirmSwitch: "false" }),
    );

    expect(result).toMatchObject({ status: "error", message: expect.any(String) });
    expect(result.fieldErrors).toBeUndefined();
    expect(await db.membership.count({ where: { ownerId: member.id } })).toBe(1);
  });

  it("points a same-plan payment to Extend", async () => {
    await signedInAdmin();
    const { member, basic } = await memberWithBasic();

    await expect(recordPaymentAction(IDLE, form({ userId: member.id, planId: basic.id, method: "CASH" }))).resolves.toEqual(
      membershipErrorResult({ code: "SAME_PLAN" }, "admin"),
    );
    expect(await db.payment.count()).toBe(0);
  });

  it("reports a note with an email address on the note field", async () => {
    await signedInAdmin();
    const member = await createUser();
    const basic = await createPlan();

    const result = await recordPaymentAction(
      IDLE,
      form({ userId: member.id, planId: basic.id, method: "CASH", note: "Receipt sent to sam@example.com" }),
    );

    expect(result).toEqual({ status: "error", fieldErrors: { note: expect.stringContaining("email addresses") } });
    expect(await db.payment.count()).toBe(0);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it("reports a missing plan and method on their fields", async () => {
    await signedInAdmin();
    const member = await createUser();

    const result = await recordPaymentAction(IDLE, form({ userId: member.id, planId: "", method: "" }));

    expect(result).toEqual({
      status: "error",
      fieldErrors: { planId: "Choose a plan", method: "Choose a payment method" },
    });
  });

  it("reports a reference already recorded for the method on the reference field", async () => {
    const admin = await signedInAdmin();
    const { membership } = await memberWithBasic();
    await createManualPayment(membership, admin.id, { method: "WHISH", reference: "TX-42" });
    const member = await createUser();
    const basic = await createPlan();

    const result = await recordPaymentAction(IDLE, form({ userId: member.id, planId: basic.id, method: "WHISH", reference: "TX-42" }));

    expect(result).toEqual(membershipErrorResult({ code: "DUPLICATE_REFERENCE" }, "admin"));
    expect(result.fieldErrors?.reference).toBeDefined();
    expect(await db.membership.count({ where: { ownerId: member.id } })).toBe(0);
  });

  it.each<Role>(["MEMBER", "TRAINER"])("refuses a %s and records nothing", async (role) => {
    const actor = await createUser({ role });
    signInAs(actor);
    const member = await createUser();
    const basic = await createPlan();

    await expect(recordPaymentAction(IDLE, form({ userId: member.id, planId: basic.id, method: "CASH" }))).resolves.toEqual({
      status: "error",
      message: AUTH_ERROR_MESSAGES.FORBIDDEN,
    });
    expect(await db.membership.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it("refuses a signed-out visitor", async () => {
    await expect(recordPaymentAction(IDLE, form({}))).resolves.toEqual({
      status: "error",
      message: AUTH_ERROR_MESSAGES.UNAUTHENTICATED,
    });
  });

  it("refuses a session whose admin role was removed in the meantime", async () => {
    await createUser({ role: "ADMIN" });
    const admin = await signedInAdmin();
    await db.user.update({ where: { id: admin.id }, data: { role: "MEMBER" } });
    const member = await createUser();
    const basic = await createPlan();

    await expect(recordPaymentAction(IDLE, form({ userId: member.id, planId: basic.id, method: "CASH" }))).resolves.toEqual(
      membershipErrorResult({ code: "ACTOR_NOT_ADMIN" }, "admin"),
    );
    expect(await db.payment.count()).toBe(0);
  });
});
