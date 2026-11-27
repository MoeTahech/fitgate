import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/memberships-ui/forms";
import { AUTH_ERROR_MESSAGES, membershipErrorResult } from "@/lib/memberships-ui/messages";
import { resetDatabase } from "../../../../tests/support/database";
import { createClassPackPlan, createOwnedMembership, createPlan, createUser } from "../../../../tests/support/factories";
import { extendMembershipAction } from "./actions";

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
// The current end, 25 days ahead (27 December, 10:00), and one month later (27 January, 10:00).
const CURRENT_END = new Date("2026-12-27T08:00:00.000Z");
const NEXT_END = new Date("2027-01-27T08:00:00.000Z");
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
  const admin = await createUser({ role: "ADMIN" });
  signInAs(admin);
  return admin;
}

async function basic(overrides: { currentPeriodEnd?: Date } = {}) {
  const owner = await createUser();
  const plan = await createPlan({ name: "Basic", priceCents: 3000 });
  const membership = await createOwnedMembership(owner, plan, {
    startsAt: at(-5 * DAY),
    currentPeriodEnd: overrides.currentPeriodEnd ?? CURRENT_END,
  });
  return { owner, plan, membership };
}

describe("extendMembershipAction", () => {
  it("records the plan's price for the next period and moves the end by one month", async () => {
    const admin = await signedInAdmin();
    const { owner, membership } = await basic();

    const result = await extendMembershipAction(
      IDLE,
      form({ membershipId: membership.id, method: "OMT", reference: "OMT-7", note: "" }),
    );

    expect(result).toEqual({ status: "success", message: expect.stringContaining("extended") });
    expect(await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({ currentPeriodEnd: NEXT_END });
    expect(await db.payment.findFirstOrThrow({ where: { membershipId: membership.id } })).toMatchObject({
      userId: owner.id,
      amountCents: 3000,
      method: "OMT",
      reference: "OMT-7",
      note: null,
      periodStart: CURRENT_END,
      periodEnd: NEXT_END,
      recordedById: admin.id,
    });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("explains a membership whose period is over and records nothing", async () => {
    await signedInAdmin();
    const { membership } = await basic({ currentPeriodEnd: at(-DAY) });

    await expect(extendMembershipAction(IDLE, form({ membershipId: membership.id, method: "CASH" }))).resolves.toEqual(
      membershipErrorResult({ code: "MEMBERSHIP_ENDED" }, "admin"),
    );
    expect(await db.payment.count()).toBe(0);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it("explains a one-time plan that can't be extended", async () => {
    await signedInAdmin();
    const owner = await createUser();
    const pack = await createClassPackPlan();
    const membership = await createOwnedMembership(owner, pack, { startsAt: at(-DAY), currentPeriodEnd: at(59 * DAY) });

    await expect(extendMembershipAction(IDLE, form({ membershipId: membership.id, method: "CASH" }))).resolves.toEqual(
      membershipErrorResult({ code: "NOT_EXTENDABLE" }, "admin"),
    );
  });

  it("reports a missing method on its field", async () => {
    await signedInAdmin();
    const { membership } = await basic();

    await expect(extendMembershipAction(IDLE, form({ membershipId: membership.id, method: "" }))).resolves.toEqual({
      status: "error",
      fieldErrors: { method: "Choose a payment method" },
    });
  });

  it.each<Role>(["MEMBER", "TRAINER"])("refuses a %s and leaves the membership as it is", async (role) => {
    signInAs(await createUser({ role }));
    const { membership } = await basic();

    await expect(extendMembershipAction(IDLE, form({ membershipId: membership.id, method: "CASH" }))).resolves.toEqual({
      status: "error",
      message: AUTH_ERROR_MESSAGES.FORBIDDEN,
    });
    expect(await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({ currentPeriodEnd: CURRENT_END });
    expect(await db.payment.count()).toBe(0);
    expect(cache.refresh).not.toHaveBeenCalled();
  });
});
