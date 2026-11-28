import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import type { ActionResult } from "@/lib/memberships-ui/forms";
import { AUTH_ERROR_MESSAGES, FREEZE_DATE_FIELD_ERRORS, membershipErrorResult } from "@/lib/memberships-ui/messages";
import type { MembershipErrorCode } from "@/lib/services/memberships/errors";
import { approveFreeze, requestFreeze } from "@/lib/services/memberships/freezes";
import { createMembershipInvite } from "@/lib/services/memberships/invites";
import { resetDatabase } from "../../../../tests/support/database";
import {
  createCouplesPlan,
  createFreeze,
  createGymTrialPlan,
  createClassTrialPlan,
  createOwnedMembership,
  createPlan,
  createSeat,
  createUser,
} from "../../../../tests/support/factories";
import { deleteMessages, waitForMessages } from "../../../../tests/support/mailpit";
import {
  cancelFreezeAction,
  createInviteAction,
  leaveMembershipAction,
  removePartnerAction,
  requestFreezeAction,
  resendInviteAction,
  revokeInviteAction,
  startTrialAction,
} from "./actions";

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

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendEmail: vi.fn(actual.sendEmail) };
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Wednesday 2 December 2026, 10:00 in Beirut (UTC+2). The gym is open 06:00-22:00 every day.
const NOW = new Date("2026-12-02T08:00:00.000Z");
// Local midnights starting Friday 4 December (the earliest freeze start from NOW) and 11 December.
const DEC_4 = new Date("2026-12-03T22:00:00.000Z");
const DEC_11 = new Date("2026-12-10T22:00:00.000Z");
const MISSING_ID = "0190f2a0-0000-7000-8000-000000000000";
const IDLE: ActionResult = { status: "idle" };

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const mailedTo: string[] = [];

/** A fresh lowercase address per call, so Mailpit searches never see other tests' messages. */
function partnerEmail(): string {
  const email = `partner-${randomUUID()}@example.test`;
  mailedTo.push(email);
  return email;
}

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

afterAll(async () => {
  await Promise.all(mailedTo.map((email) => deleteMessages(email)));
});

function signInAs(user: { id: string; name: string; email: string; role: Role }) {
  session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const memberError = (code: MembershipErrorCode) => membershipErrorResult({ code }, "member");

/** A running front-desk Basic membership (period 5 days ago to 25 days ahead) with its owner. */
async function basic() {
  const owner = await createUser({ name: "Sam Owner" });
  const plan = await createPlan({ name: "Basic" });
  const membership = await createOwnedMembership(owner, plan, { startsAt: at(-5 * DAY), currentPeriodEnd: at(25 * DAY) });
  return { owner, plan, membership };
}

/** A running Couples membership (period 5 days ago to 25 days ahead) with its owner. */
async function couples() {
  const owner = await createUser({ name: "Sam Owner" });
  const plan = await createCouplesPlan({ name: "Couples Premium" });
  const membership = await createOwnedMembership(owner, plan, { startsAt: at(-5 * DAY), currentPeriodEnd: at(25 * DAY) });
  return { owner, plan, membership };
}

/** A running Couples membership with a partner seat taken yesterday. */
async function couplesWithPartner() {
  const setup = await couples();
  const partner = await createUser({ name: "Alex Partner" });
  const seat = await createSeat(setup.membership.id, partner.id, { role: "PARTNER", joinedAt: at(-DAY) });
  return { ...setup, partner, seat };
}

describe("signed out", () => {
  const actions = {
    startTrialAction,
    requestFreezeAction,
    cancelFreezeAction,
    createInviteAction,
    resendInviteAction,
    revokeInviteAction,
    removePartnerAction,
    leaveMembershipAction,
  };

  it.each(Object.entries(actions))("%s asks to sign in again and refreshes nothing", async (_name, action) => {
    await expect(action(IDLE, form({}))).resolves.toEqual({ status: "error", message: AUTH_ERROR_MESSAGES.UNAUTHENTICATED });
    expect(cache.refresh).not.toHaveBeenCalled();
  });
});

describe("startTrialAction", () => {
  it("starts the Gym Trial with the request's IP hash and refreshes the page", async () => {
    await createGymTrialPlan({ name: "Gym Trial" });
    const member = await createUser();
    signInAs(member);

    const result = await startTrialAction(IDLE, form({ kind: "GYM" }));

    expect(result).toEqual({ status: "success", message: "Your Gym Trial has started." });
    const trial = await db.membership.findFirstOrThrow({ where: { ownerId: member.id } });
    expect(trial).toMatchObject({ source: "TRIAL", status: "ACTIVE", currentPeriodEnd: new Date("2026-12-02T20:00:00.000Z") });
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "membership.trial_started" } });
    expect(row.ipHash).toBe(`hash:${request.ip}`);
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("starts the Class Trial", async () => {
    await createClassTrialPlan({ name: "Class Trial" });
    const member = await createUser();
    signInAs(member);

    await expect(startTrialAction(IDLE, form({ kind: "CLASS" }))).resolves.toEqual({
      status: "success",
      message: "Your Class Trial has started.",
    });
  });

  it("refuses a second Gym Trial with the already-used copy", async () => {
    await createGymTrialPlan({ name: "Gym Trial" });
    const member = await createUser();
    signInAs(member);
    await startTrialAction(IDLE, form({ kind: "GYM" }));
    cache.refresh.mockClear();

    await expect(startTrialAction(IDLE, form({ kind: "GYM" }))).resolves.toEqual(memberError("TRIAL_ALREADY_USED"));
    expect(await db.membership.count({ where: { ownerId: member.id } })).toBe(1);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it("explains an unverified email", async () => {
    await createGymTrialPlan();
    const member = await createUser({ emailVerified: false });
    signInAs(member);

    await expect(startTrialAction(IDLE, form({ kind: "GYM" }))).resolves.toEqual(memberError("EMAIL_NOT_VERIFIED"));
    expect(await db.membership.count()).toBe(0);
  });

  it("asks to reload on an unknown kind", async () => {
    signInAs(await createUser());

    const result = await startTrialAction(IDLE, form({ kind: "SAUNA" }));

    expect(result).toEqual({ status: "error", message: expect.stringContaining("Reload the page") });
    expect(cache.refresh).not.toHaveBeenCalled();
  });
});

describe("requestFreezeAction", () => {
  function submit(membershipId: string, firstDay: string, lastDay: string) {
    return requestFreezeAction(IDLE, form({ membershipId, firstDay, lastDay }));
  }

  it("requests whole local days, from the first day's midnight to the day after the last", async () => {
    const { owner, membership } = await basic();
    signInAs(owner);

    const result = await submit(membership.id, "2026-12-04", "2026-12-10");

    expect(result).toEqual({ status: "success", message: "Freeze requested. The gym will confirm it before it starts." });
    const freeze = await db.membershipFreeze.findFirstOrThrow({ where: { membershipId: membership.id } });
    expect(freeze).toMatchObject({ status: "REQUESTED", startsAt: DEC_4, endsAt: DEC_11, requestedById: owner.id });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("reports bad dates on their fields before calling the service", async () => {
    const { owner, membership } = await basic();
    signInAs(owner);

    await expect(submit(membership.id, "2026-12-10", "2026-12-04")).resolves.toEqual({
      status: "error",
      fieldErrors: { lastDay: "The last day can't be before the first day" },
    });
    await expect(submit(membership.id, "2026-12-04", "2027-01-03")).resolves.toEqual({
      status: "error",
      fieldErrors: { lastDay: "A freeze lasts at most 30 days" },
    });
    await expect(submit(membership.id, "", "2026-12-31-x")).resolves.toEqual({
      status: "error",
      fieldErrors: { firstDay: "Enter a date", lastDay: "Enter a valid date" },
    });
    expect(await db.membershipFreeze.count()).toBe(0);
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it("maps a start before the day after tomorrow to the first day field", async () => {
    const { owner, membership } = await basic();
    signInAs(owner);

    await expect(submit(membership.id, "2026-12-03", "2026-12-05")).resolves.toEqual({
      status: "error",
      fieldErrors: { firstDay: FREEZE_DATE_FIELD_ERRORS.TOO_SOON.message },
    });
    expect(await db.membershipFreeze.count()).toBe(0);
  });

  it("maps a start after the period end to the first day field", async () => {
    const { owner, membership } = await basic();
    signInAs(owner);

    await expect(submit(membership.id, "2026-12-28", "2026-12-30")).resolves.toEqual({
      status: "error",
      fieldErrors: { firstDay: FREEZE_DATE_FIELD_ERRORS.AFTER_PERIOD_END.message },
    });
  });

  it("shows a stale membership id as a message, not a field error", async () => {
    const { owner } = await basic();
    signInAs(owner);

    const result = await submit("not-an-id", "2026-12-04", "2026-12-10");

    expect(result).toEqual({ status: "error", message: expect.stringContaining("Reload the page") });
  });

  it("refuses someone else's membership", async () => {
    const { membership } = await basic();
    signInAs(await createUser());

    await expect(submit(membership.id, "2026-12-04", "2026-12-10")).resolves.toEqual(memberError("NOT_OWNER"));
    expect(await db.membershipFreeze.count()).toBe(0);
  });
});

describe("cancelFreezeAction", () => {
  it("cancels a requested freeze", async () => {
    const { owner, membership } = await basic();
    const freeze = await createFreeze(membership.id, owner.id, { startsAt: DEC_4, endsAt: DEC_11 });
    signInAs(owner);

    const result = await cancelFreezeAction(IDLE, form({ freezeId: freeze.id }));

    expect(result).toEqual({ status: "success", message: "Freeze request cancelled." });
    expect(await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id } })).toMatchObject({ status: "CANCELLED" });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("cancels an approved freeze and moves the end date back", async () => {
    const { owner, membership } = await basic();
    const admin = await createUser({ role: "ADMIN" });
    const { freezeId } = await requestFreeze({
      userId: owner.id,
      membershipId: membership.id,
      firstDay: "2026-12-04",
      lastDay: "2026-12-10",
      ipHash: null,
    });
    await approveFreeze({ actorId: admin.id, freezeId, ipHash: null });
    signInAs(owner);

    const result = await cancelFreezeAction(IDLE, form({ freezeId }));

    expect(result).toEqual({ status: "success", message: "Freeze cancelled. Your end date moved back." });
    const after = await db.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(after.currentPeriodEnd).toEqual(membership.currentPeriodEnd);
  });

  it("refuses a member who doesn't own the membership and leaves the freeze open", async () => {
    const { owner, membership } = await basic();
    const freeze = await createFreeze(membership.id, owner.id, { startsAt: DEC_4, endsAt: DEC_11 });
    signInAs(await createUser());

    await expect(cancelFreezeAction(IDLE, form({ freezeId: freeze.id }))).resolves.toEqual(memberError("NOT_OWNER"));
    expect(await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id } })).toMatchObject({ status: "REQUESTED" });
    expect(cache.refresh).not.toHaveBeenCalled();
  });

  it("explains a freeze that no longer exists", async () => {
    signInAs(await createUser());

    await expect(cancelFreezeAction(IDLE, form({ freezeId: MISSING_ID }))).resolves.toEqual(memberError("FREEZE_NOT_FOUND"));
  });
});

describe("createInviteAction", () => {
  it("creates the invite, emails it, and refreshes the page", async () => {
    const { owner, membership } = await couples();
    const email = partnerEmail();
    signInAs(owner);

    const result = await createInviteAction(IDLE, form({ membershipId: membership.id, email: email.toUpperCase() }));

    expect(result).toEqual({ status: "success", message: "Invite sent." });
    expect(await db.membershipInvite.findFirstOrThrow({ where: { membershipId: membership.id } })).toMatchObject({
      email,
      status: "PENDING",
    });
    expect(await waitForMessages(email)).toHaveLength(1);
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the own-email error on the email field", async () => {
    const { owner, membership } = await couples();
    signInAs(owner);

    const result = await createInviteAction(IDLE, form({ membershipId: membership.id, email: owner.email }));

    expect(result).toEqual(memberError("INVITE_OWN_EMAIL"));
    expect(result.fieldErrors?.email).toBeDefined();
    expect(await db.membershipInvite.count()).toBe(0);
  });

  it("reports an invalid email on the field", async () => {
    const { owner, membership } = await couples();
    signInAs(owner);

    const result = await createInviteAction(IDLE, form({ membershipId: membership.id, email: "not-an-email" }));

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.email).toBeDefined();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("keeps the invite when the email fails and points to Resend", async () => {
    const { owner, membership } = await couples();
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("SMTP unavailable"));
    signInAs(owner);

    const result = await createInviteAction(IDLE, form({ membershipId: membership.id, email: partnerEmail() }));

    expect(result).toEqual({ status: "error", message: expect.stringContaining("Use Resend") });
    expect(await db.membershipInvite.count({ where: { membershipId: membership.id, status: "PENDING" } })).toBe(1);
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("refuses a plan that can't be shared", async () => {
    const { owner, membership } = await basic();
    signInAs(owner);

    await expect(createInviteAction(IDLE, form({ membershipId: membership.id, email: partnerEmail() }))).resolves.toEqual(
      memberError("NOT_COUPLES_PLAN"),
    );
  });
});

describe("resendInviteAction and revokeInviteAction", () => {
  async function pendingInvite() {
    const setup = await couples();
    const email = partnerEmail();
    const issued = await createMembershipInvite({ ownerId: setup.owner.id, membershipId: setup.membership.id, email, ipHash: null });
    return { ...setup, email, issued };
  }

  it("resends the invite as a new one for the same email", async () => {
    const { owner, membership, email, issued } = await pendingInvite();
    signInAs(owner);

    const result = await resendInviteAction(IDLE, form({ inviteId: issued.inviteId }));

    expect(result).toEqual({ status: "success", message: "Invite sent." });
    const pending = await db.membershipInvite.findMany({ where: { membershipId: membership.id, status: "PENDING" } });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ email });
    expect(pending[0]?.id).not.toBe(issued.inviteId);
    expect(await waitForMessages(email)).toHaveLength(1);
  });

  it("revokes a pending invite", async () => {
    const { owner, issued } = await pendingInvite();
    signInAs(owner);

    const result = await revokeInviteAction(IDLE, form({ inviteId: issued.inviteId }));

    expect(result).toEqual({ status: "success", message: "Invite withdrawn." });
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: issued.inviteId } })).toMatchObject({
      status: "REVOKED",
      revokedById: owner.id,
    });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("refuses another member and leaves the invite pending", async () => {
    const { issued } = await pendingInvite();
    signInAs(await createUser());

    await expect(revokeInviteAction(IDLE, form({ inviteId: issued.inviteId }))).resolves.toEqual(memberError("NOT_OWNER"));
    await expect(resendInviteAction(IDLE, form({ inviteId: issued.inviteId }))).resolves.toEqual(memberError("NOT_OWNER"));
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: issued.inviteId } })).toMatchObject({ status: "PENDING" });
    expect(cache.refresh).not.toHaveBeenCalled();
  });
});

describe("removePartnerAction and leaveMembershipAction", () => {
  it("the owner removes the partner, ending the seat now", async () => {
    const { owner, seat } = await couplesWithPartner();
    signInAs(owner);

    const result = await removePartnerAction(IDLE, form({ seatId: seat.id }));

    expect(result).toEqual({ status: "success", message: "Partner removed." });
    expect(await db.membershipMember.findUniqueOrThrow({ where: { id: seat.id } })).toMatchObject({ endedAt: NOW });
    expect(cache.refresh).toHaveBeenCalledTimes(1);
  });

  it("the partner leaves, ending their seat now", async () => {
    const { membership, partner, seat } = await couplesWithPartner();
    signInAs(partner);

    const result = await leaveMembershipAction(IDLE, form({ membershipId: membership.id }));

    expect(result).toEqual({ status: "success", message: "You've left the membership." });
    expect(await db.membershipMember.findUniqueOrThrow({ where: { id: seat.id } })).toMatchObject({ endedAt: NOW });
  });

  it("refuses the partner removing themselves through the owner's action", async () => {
    const { partner, seat } = await couplesWithPartner();
    signInAs(partner);

    await expect(removePartnerAction(IDLE, form({ seatId: seat.id }))).resolves.toEqual(memberError("NOT_OWNER"));
    expect(await db.membershipMember.findUniqueOrThrow({ where: { id: seat.id } })).toMatchObject({ endedAt: null });
  });

  it("the owner can't leave their own membership", async () => {
    const { owner, membership } = await couplesWithPartner();
    signInAs(owner);

    await expect(leaveMembershipAction(IDLE, form({ membershipId: membership.id }))).resolves.toEqual(
      memberError("PARTNER_NOT_FOUND"),
    );
    expect(await db.membershipMember.count({ where: { membershipId: membership.id, endedAt: null } })).toBe(2);
    expect(cache.refresh).not.toHaveBeenCalled();
  });
});
