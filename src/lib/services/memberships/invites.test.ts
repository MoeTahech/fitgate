import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { resetDatabase } from "../../../../tests/support/database";
import {
  createCouplesPlan,
  createFreeze,
  createOwnedMembership,
  createPlan,
  createSeat,
  createUser,
} from "../../../../tests/support/factories";
import { deleteMessages, readMessageText, waitForMessages } from "../../../../tests/support/mailpit";
import { expectMembershipError } from "../../../../tests/support/membership-errors";
import {
  acceptMembershipInvite,
  createMembershipInvite,
  findMembershipInviteByToken,
  leaveMembership,
  removePartner,
  resendMembershipInvite,
  revokeMembershipInvite,
  sendMembershipInvite,
} from "./invites";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Wednesday 2 December 2026, 10:00 in Beirut (UTC+2).
const NOW = new Date("2026-12-02T08:00:00.000Z");
const IN_SEVEN_DAYS = new Date("2026-12-09T08:00:00.000Z");

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
  await resetDatabase();
  await db.gymSettings.create({ data: { id: 1, name: "Gym", timeZone: "Asia/Beirut", capacity: 50 } });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await Promise.all(mailedTo.map((email) => deleteMessages(email)));
});

/** A running Couples membership (period 5 days ago to 25 days ahead) with its owner seat. */
async function couples(overrides: Parameters<typeof createOwnedMembership>[2] = {}) {
  const owner = await createUser({ name: "Sam Owner" });
  const plan = await createCouplesPlan({ name: "Couples Premium" });
  const membership = await createOwnedMembership(owner, plan, {
    startsAt: at(-5 * DAY),
    currentPeriodEnd: at(25 * DAY),
    ...overrides,
  });
  return { owner, plan, membership };
}

function invite(owner: { id: string }, membership: { id: string }, email: string) {
  return createMembershipInvite({ ownerId: owner.id, membershipId: membership.id, email, ipHash: "ip-hash" });
}

function accept(user: { id: string }, token: string) {
  return acceptMembershipInvite({ userId: user.id, token, ipHash: "ip-hash" });
}

/** A couples membership with a pending invite and the invited person's account. */
async function pendingInvite() {
  const setup = await couples();
  const email = partnerEmail();
  const issued = await invite(setup.owner, setup.membership, email);
  const partner = await createUser({ email, name: "Alex Partner" });
  return { ...setup, email, issued, partner };
}

async function auditActions() {
  return (await db.auditLog.findMany({ orderBy: { id: "asc" } })).map((row) => row.action);
}

describe("createMembershipInvite", () => {
  it("issues a 7-day invite stored as a hash, audits without the email, and emails the link", async () => {
    const { owner, membership } = await couples();
    const email = partnerEmail();

    const issued = await invite(owner, membership, email.toUpperCase());

    expect(issued).toEqual({
      inviteId: expect.any(String),
      membershipId: membership.id,
      email,
      token: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
      expiresAt: IN_SEVEN_DAYS,
      inviterName: "Sam Owner",
      planName: "Couples Premium",
    });
    const row = await db.membershipInvite.findUniqueOrThrow({ where: { id: issued.inviteId } });
    expect(row).toMatchObject({
      membershipId: membership.id,
      email,
      tokenHash: sha256(issued.token),
      invitedById: owner.id,
      status: "PENDING",
      createdAt: NOW,
      expiresAt: IN_SEVEN_DAYS,
    });
    expect(JSON.stringify(row)).not.toContain(issued.token);

    const audits = await db.auditLog.findMany();
    expect(audits).toEqual([
      expect.objectContaining({
        actorId: owner.id,
        action: "membership_invite.created",
        targetType: "membership_invite",
        targetId: issued.inviteId,
        details: { membershipId: membership.id },
        ipHash: "ip-hash",
        createdAt: NOW,
      }),
    ]);
    expect(JSON.stringify(audits)).not.toContain(email);

    expect(await sendMembershipInvite(issued)).toBe(true);
    const [message] = await waitForMessages(email);
    expect(message?.Subject).toBe("You're invited to share a FitGate membership");
    const text = await readMessageText(message.ID);
    expect(text).toContain(`${env.BETTER_AUTH_URL}/invite/membership/${issued.token}`);
    expect(text).toContain("Sam Owner invited you to share their Couples Premium membership at FitGate.");
    expect(text).toContain("The invite expires on 9 December 2026 at 10:00.");
  });

  it("revokes the previous pending invite as superseded", async () => {
    const { owner, membership } = await couples();
    const first = await invite(owner, membership, partnerEmail());

    const second = await invite(owner, membership, partnerEmail());

    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: first.inviteId } })).toMatchObject({
      status: "REVOKED",
      revokedAt: NOW,
      revokedById: owner.id,
    });
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: second.inviteId } })).toMatchObject({ status: "PENDING" });
    expect(await db.auditLog.findFirst({ where: { action: "membership_invite.revoked" } })).toMatchObject({
      targetId: first.inviteId,
      details: { membershipId: membership.id, via: "superseded" },
    });
  });

  it("marks a lapsed pending invite EXPIRED instead of revoking it", async () => {
    const { owner, membership } = await couples();
    const first = await invite(owner, membership, partnerEmail());
    vi.setSystemTime(at(7 * DAY));

    await invite(owner, membership, partnerEmail());

    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: first.inviteId } })).toMatchObject({
      status: "EXPIRED",
      revokedAt: null,
    });
  });

  it("rejects plans without a second seat and memberships whose seats are taken", async () => {
    const owner = await createUser();
    const single = await createOwnedMembership(owner, await createPlan(), { currentPeriodEnd: at(25 * DAY) });
    await expectMembershipError(invite(owner, single, partnerEmail()), "NOT_COUPLES_PLAN");

    const full = await couples();
    await createSeat(full.membership.id, (await createUser()).id, { role: "PARTNER" });
    await expectMembershipError(invite(full.owner, full.membership, partnerEmail()), "NO_FREE_SEAT");
    expect(await db.membershipInvite.count()).toBe(0);
  });

  it("rejects the owner's own email", async () => {
    const { owner, membership } = await couples();
    await expectMembershipError(invite(owner, membership, owner.email), "INVITE_OWN_EMAIL");
  });

  it("rejects anyone but the owner, including admins", async () => {
    const { membership } = await couples();
    await expectMembershipError(invite(await createUser(), membership, partnerEmail()), "NOT_OWNER");
    await expectMembershipError(invite(await createUser({ role: "ADMIN" }), membership, partnerEmail()), "NOT_OWNER");
    await expectMembershipError(invite(await createUser(), { id: randomUUID() }, partnerEmail()), "MEMBERSHIP_NOT_FOUND");
  });

  it("rejects ended, overdue, and frozen memberships", async () => {
    const ended = await couples({ status: "EXPIRED", startsAt: at(-40 * DAY), currentPeriodEnd: at(-10 * DAY) });
    await expectMembershipError(invite(ended.owner, ended.membership, partnerEmail()), "MEMBERSHIP_ENDED");

    const overdue = await couples({ currentPeriodEnd: at(-HOUR) });
    await expectMembershipError(invite(overdue.owner, overdue.membership, partnerEmail()), "MEMBERSHIP_ENDED");

    const frozen = await couples();
    await createFreeze(frozen.membership.id, frozen.owner.id, { status: "APPROVED", startsAt: at(-DAY), endsAt: at(5 * DAY) });
    await expectMembershipError(invite(frozen.owner, frozen.membership, partnerEmail()), "MEMBERSHIP_NOT_USABLE");
    expect(await db.membershipInvite.count()).toBe(0);
  });

  it("answers the same for an email that holds a base seat; acceptance then fails with HAS_ACTIVE_BASE", async () => {
    const { owner, membership } = await couples();
    const taken = await createUser({ email: partnerEmail() });
    const base = await createOwnedMembership(taken, await createPlan(), { currentPeriodEnd: at(25 * DAY) });
    const fresh = partnerEmail();

    const forTaken = await invite(owner, membership, taken.email);
    const shape = (issued: object) => Object.keys(issued).sort();
    const other = await couples();
    const forFresh = await invite(other.owner, other.membership, fresh);
    expect(shape(forTaken)).toEqual(shape(forFresh));
    expect(forTaken.expiresAt).toEqual(forFresh.expiresAt);

    await expectMembershipError(accept(taken, forTaken.token), "HAS_ACTIVE_BASE");
    expect(await db.membershipMember.count({ where: { membershipId: membership.id } })).toBe(1);
    expect(await db.membershipMember.findFirstOrThrow({ where: { membershipId: base.id } })).toMatchObject({ endedAt: null });
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: forTaken.inviteId } })).toMatchObject({ status: "PENDING" });
  });

  it("counts creates and resends together: the 11th in a day is blocked", async () => {
    const { owner, membership } = await couples();
    let latest = await invite(owner, membership, partnerEmail());
    for (let i = 0; i < 5; i++) latest = await invite(owner, membership, partnerEmail());
    for (let i = 0; i < 4; i++) {
      latest = await resendMembershipInvite({ actorId: owner.id, inviteId: latest.inviteId, ipHash: null });
    }

    const limited = await expectMembershipError(invite(owner, membership, partnerEmail()), "RATE_LIMITED");
    expect(limited.details?.retryAfterSeconds).toBeGreaterThan(0);
    await expectMembershipError(resendMembershipInvite({ actorId: owner.id, inviteId: latest.inviteId, ipHash: null }), "RATE_LIMITED");
    expect(await db.membershipInvite.count()).toBe(10);
    expect(await db.membershipInvite.count({ where: { status: "PENDING" } })).toBe(1);
  });
});

describe("resendMembershipInvite", () => {
  it("replaces a pending invite with a new token for the same email", async () => {
    const { owner, membership, email, issued } = await pendingInvite();

    const resent = await resendMembershipInvite({ actorId: owner.id, inviteId: issued.inviteId, ipHash: null });

    expect(resent).toMatchObject({ email, membershipId: membership.id, expiresAt: IN_SEVEN_DAYS });
    expect(resent.token).not.toBe(issued.token);
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: issued.inviteId } })).toMatchObject({ status: "REVOKED" });
    expect(await db.auditLog.findFirst({ where: { action: "membership_invite.created", targetId: resent.inviteId } })).toMatchObject({
      details: { membershipId: membership.id, resentFromId: issued.inviteId },
    });
    await expectMembershipError(accept({ id: owner.id }, issued.token), "INVITE_REVOKED");
  });

  it("resends an expired invite from its new date", async () => {
    const { owner, issued } = await pendingInvite();
    vi.setSystemTime(at(8 * DAY));

    const resent = await resendMembershipInvite({ actorId: owner.id, inviteId: issued.inviteId, ipHash: null });

    expect(resent.expiresAt).toEqual(at(15 * DAY));
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: issued.inviteId } })).toMatchObject({ status: "EXPIRED" });
  });

  it("rejects accepted and revoked invites, and anyone but the owner", async () => {
    const { owner, issued, partner } = await pendingInvite();
    await expectMembershipError(resendMembershipInvite({ actorId: partner.id, inviteId: issued.inviteId, ipHash: null }), "NOT_OWNER");

    await accept(partner, issued.token);
    await expectMembershipError(
      resendMembershipInvite({ actorId: owner.id, inviteId: issued.inviteId, ipHash: null }),
      "INVITE_NOT_PENDING",
    );

    const other = await pendingInvite();
    await revokeMembershipInvite({ actorId: other.owner.id, inviteId: other.issued.inviteId, ipHash: null });
    await expectMembershipError(
      resendMembershipInvite({ actorId: other.owner.id, inviteId: other.issued.inviteId, ipHash: null }),
      "INVITE_NOT_PENDING",
    );
    await expectMembershipError(resendMembershipInvite({ actorId: owner.id, inviteId: randomUUID(), ipHash: null }), "INVITE_NOT_FOUND");
  });
});

describe("revokeMembershipInvite", () => {
  it("lets the owner or an admin revoke a pending invite", async () => {
    const byOwner = await pendingInvite();
    await revokeMembershipInvite({ actorId: byOwner.owner.id, inviteId: byOwner.issued.inviteId, ipHash: "ip-hash" });
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: byOwner.issued.inviteId } })).toMatchObject({
      status: "REVOKED",
      revokedAt: NOW,
      revokedById: byOwner.owner.id,
    });

    const admin = await createUser({ role: "ADMIN" });
    const byAdmin = await pendingInvite();
    await revokeMembershipInvite({ actorId: admin.id, inviteId: byAdmin.issued.inviteId, ipHash: "ip-hash" });
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: byAdmin.issued.inviteId } })).toMatchObject({
      status: "REVOKED",
      revokedById: admin.id,
    });

    const revoked = await db.auditLog.findMany({ where: { action: "membership_invite.revoked" }, orderBy: { id: "asc" } });
    expect(revoked.map((row) => [row.actorId, row.details])).toEqual([
      [byOwner.owner.id, { membershipId: byOwner.membership.id, via: "owner" }],
      [admin.id, { membershipId: byAdmin.membership.id, via: "admin" }],
    ]);
    await expectMembershipError(accept(byOwner.partner, byOwner.issued.token), "INVITE_REVOKED");
  });

  it("rejects other members, trainers, and invites that are no longer pending", async () => {
    const { owner, issued, partner } = await pendingInvite();
    const revoke = (actorId: string) => revokeMembershipInvite({ actorId, inviteId: issued.inviteId, ipHash: null });

    await expectMembershipError(revoke(partner.id), "NOT_OWNER");
    await expectMembershipError(revoke((await createUser({ role: "TRAINER" })).id), "NOT_OWNER");
    await expectMembershipError(revoke((await createUser({ role: "ADMIN", anonymizedAt: NOW })).id), "ACTOR_NOT_ADMIN");

    vi.setSystemTime(at(7 * DAY));
    await expectMembershipError(revoke(owner.id), "INVITE_NOT_PENDING");
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: issued.inviteId } })).toMatchObject({ status: "PENDING" });
  });
});

describe("acceptMembershipInvite", () => {
  it("adds a PARTNER base seat, marks the invite accepted, and audits without the email", async () => {
    const { owner, membership, issued, partner, email } = await pendingInvite();
    vi.setSystemTime(at(HOUR));

    const result = await accept(partner, issued.token);

    expect(result).toEqual({ membershipId: membership.id, inviteId: issued.inviteId, seatId: expect.any(String) });
    expect(await db.membershipMember.findMany({ where: { membershipId: membership.id }, orderBy: { role: "asc" } })).toEqual([
      expect.objectContaining({ userId: owner.id, role: "OWNER", endedAt: null }),
      expect.objectContaining({ id: result.seatId, userId: partner.id, role: "PARTNER", planType: "BASE", joinedAt: at(HOUR), endedAt: null }),
    ]);
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: issued.inviteId } })).toMatchObject({
      status: "ACCEPTED",
      acceptedAt: at(HOUR),
      acceptedById: partner.id,
    });

    const audits = await db.auditLog.findMany({ where: { actorId: partner.id }, orderBy: { id: "asc" } });
    expect(audits).toEqual([
      expect.objectContaining({
        action: "membership_invite.accepted",
        targetType: "membership_invite",
        targetId: issued.inviteId,
        details: { membershipId: membership.id },
        ipHash: "ip-hash",
        createdAt: at(HOUR),
      }),
      expect.objectContaining({
        action: "membership.partner_joined",
        targetType: "membership",
        targetId: membership.id,
        details: { seatId: result.seatId, inviteId: issued.inviteId },
        createdAt: at(HOUR),
      }),
    ]);
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(email);
  });

  it("rejects a different account and an unverified email", async () => {
    const { issued, email } = await pendingInvite();
    await expectMembershipError(accept(await createUser(), issued.token), "EMAIL_MISMATCH");

    await db.user.update({ where: { email }, data: { emailVerified: false } });
    const unverified = await db.user.findUniqueOrThrow({ where: { email } });
    await expectMembershipError(accept(unverified, issued.token), "EMAIL_NOT_VERIFIED");
    await expectMembershipError(accept(await createUser({ anonymizedAt: NOW }), issued.token), "USER_ANONYMIZED");
    expect(await db.membershipMember.count({ where: { role: "PARTNER" } })).toBe(0);
  });

  it("rejects an expired invite and records it as EXPIRED", async () => {
    const { issued, partner } = await pendingInvite();
    vi.setSystemTime(IN_SEVEN_DAYS);

    await expectMembershipError(accept(partner, issued.token), "INVITE_EXPIRED");

    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: issued.inviteId } })).toMatchObject({ status: "EXPIRED" });
    await expectMembershipError(accept(partner, issued.token), "INVITE_EXPIRED");
  });

  it("rejects used invites and unknown or malformed tokens", async () => {
    const { issued, partner } = await pendingInvite();
    await accept(partner, issued.token);

    await expectMembershipError(accept(partner, issued.token), "INVITE_ALREADY_ACCEPTED");
    await expectMembershipError(accept(partner, "x".repeat(43)), "INVITE_NOT_FOUND");
    await expectMembershipError(accept(partner, "not a token"), "INVITE_NOT_FOUND");
    await expectMembershipError(accept(partner, ""), "INVITE_NOT_FOUND");
  });

  it("rejects the owner accepting an invite to their own membership", async () => {
    const { owner, issued, partner } = await pendingInvite();
    await db.user.update({ where: { id: partner.id }, data: { email: `old-${partner.email}` } });
    await db.user.update({ where: { id: owner.id }, data: { email: issued.email } });

    await expectMembershipError(accept(owner, issued.token), "OWN_MEMBERSHIP");
  });

  it("rejects when the seat was taken after the invite was sent", async () => {
    const { membership, issued, partner } = await pendingInvite();
    await createSeat(membership.id, (await createUser()).id, { role: "PARTNER" });

    await expectMembershipError(accept(partner, issued.token), "NO_FREE_SEAT");
  });

  it("closes the accepter's lapsed base first, then accepts", async () => {
    const { membership, issued, partner } = await pendingInvite();
    const lapsed = await createOwnedMembership(partner, await createPlan(), {
      startsAt: at(-31 * DAY),
      currentPeriodEnd: at(-DAY),
    });

    await accept(partner, issued.token);

    expect(await db.membership.findUniqueOrThrow({ where: { id: lapsed.id } })).toMatchObject({
      status: "EXPIRED",
      endedAt: at(-DAY),
    });
    expect(await db.membershipMember.count({ where: { membershipId: membership.id, endedAt: null } })).toBe(2);
    expect(await db.auditLog.findFirst({ where: { action: "membership.ended", targetId: lapsed.id } })).toMatchObject({
      details: { status: "EXPIRED", via: "overdue_cleanup", trigger: "invite_accept" },
    });
  });

  it("ends a membership whose period is over and fails; the invite then reads as ended", async () => {
    const { membership, issued, partner } = await pendingInvite();
    await db.membership.update({ where: { id: membership.id }, data: { currentPeriodEnd: at(2 * DAY) } });
    vi.setSystemTime(at(3 * DAY));

    await expectMembershipError(accept(partner, issued.token), "MEMBERSHIP_ENDED");

    expect(await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({
      status: "EXPIRED",
      endedAt: at(2 * DAY),
    });
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: issued.inviteId } })).toMatchObject({
      status: "REVOKED",
      revokedById: null,
    });
    expect(await db.membershipMember.count({ where: { membershipId: membership.id, endedAt: null } })).toBe(0);
    await expectMembershipError(accept(partner, issued.token), "MEMBERSHIP_ENDED");
    expect(await findMembershipInviteByToken(issued.token)).toEqual({ state: "ended" });
  });

  it("succeeds once for two concurrent accepts", async () => {
    const { membership, issued, partner } = await pendingInvite();

    const results = await Promise.allSettled([accept(partner, issued.token), accept(partner, issued.token)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    await expectMembershipError(Promise.reject(rejected?.reason), "INVITE_ALREADY_ACCEPTED");
    expect(await db.membershipMember.count({ where: { membershipId: membership.id, role: "PARTNER" } })).toBe(1);
  });
});

describe("removePartner and leaveMembership", () => {
  it("the owner removes the partner, which frees the seat for a new invite", async () => {
    const { owner, membership, issued, partner } = await pendingInvite();
    const { seatId } = await accept(partner, issued.token);
    vi.setSystemTime(at(DAY));

    expect(await removePartner({ actorId: owner.id, seatId, ipHash: "ip-hash" })).toEqual({ membershipId: membership.id, seatId });

    expect(await db.membershipMember.findUniqueOrThrow({ where: { id: seatId } })).toMatchObject({ endedAt: at(DAY) });
    expect(await db.auditLog.findFirst({ where: { action: "membership.partner_removed" } })).toMatchObject({
      actorId: owner.id,
      targetId: membership.id,
      details: { seatId, via: "owner" },
      createdAt: at(DAY),
    });

    const next = await createUser({ email: partnerEmail() });
    const second = await invite(owner, membership, next.email);
    await accept(next, second.token);
    expect(await db.membershipMember.count({ where: { membershipId: membership.id, endedAt: null } })).toBe(2);
    await expectMembershipError(removePartner({ actorId: owner.id, seatId, ipHash: null }), "PARTNER_NOT_FOUND");
  });

  it("lets an admin remove the partner, but not the partner or other members", async () => {
    const { membership, issued, partner } = await pendingInvite();
    const { seatId } = await accept(partner, issued.token);

    await expectMembershipError(removePartner({ actorId: partner.id, seatId, ipHash: null }), "NOT_OWNER");
    await expectMembershipError(removePartner({ actorId: (await createUser()).id, seatId, ipHash: null }), "NOT_OWNER");

    const admin = await createUser({ role: "ADMIN" });
    await removePartner({ actorId: admin.id, seatId, ipHash: null });
    expect(await db.auditLog.findFirst({ where: { action: "membership.partner_removed" } })).toMatchObject({
      actorId: admin.id,
      details: { seatId, via: "admin" },
    });
    expect(await db.membershipMember.count({ where: { membershipId: membership.id, endedAt: null } })).toBe(1);
  });

  it("rejects removing the owner's seat", async () => {
    const { owner, membership } = await couples();
    const ownerSeat = await db.membershipMember.findFirstOrThrow({ where: { membershipId: membership.id } });
    await expectMembershipError(removePartner({ actorId: owner.id, seatId: ownerSeat.id, ipHash: null }), "PARTNER_NOT_FOUND");
  });

  it("lets the partner leave, after which they can take another base", async () => {
    const { owner, membership, issued, partner } = await pendingInvite();
    const { seatId } = await accept(partner, issued.token);

    await expectMembershipError(leaveMembership({ userId: owner.id, membershipId: membership.id, ipHash: null }), "PARTNER_NOT_FOUND");
    expect(await leaveMembership({ userId: partner.id, membershipId: membership.id, ipHash: "ip-hash" })).toEqual({
      membershipId: membership.id,
      seatId,
    });

    expect(await db.membershipMember.findUniqueOrThrow({ where: { id: seatId } })).toMatchObject({ endedAt: NOW });
    expect(await db.auditLog.findFirst({ where: { action: "membership.partner_left" } })).toMatchObject({
      actorId: partner.id,
      targetId: membership.id,
      details: { seatId },
    });
    await expect(createOwnedMembership(partner, await createPlan())).resolves.toMatchObject({ ownerId: partner.id });
    await expectMembershipError(leaveMembership({ userId: partner.id, membershipId: membership.id, ipHash: null }), "PARTNER_NOT_FOUND");
  });

  it("rejects seat changes on a membership whose period is over", async () => {
    const { membership, issued, partner } = await pendingInvite();
    const { seatId } = await accept(partner, issued.token);
    vi.setSystemTime(at(26 * DAY));

    await expectMembershipError(leaveMembership({ userId: partner.id, membershipId: membership.id, ipHash: null }), "MEMBERSHIP_ENDED");
    await expectMembershipError(removePartner({ actorId: membership.ownerId, seatId, ipHash: null }), "MEMBERSHIP_ENDED");
  });
});

describe("findMembershipInviteByToken", () => {
  it("reports a valid invite with the inviter and plan", async () => {
    const { issued, email } = await pendingInvite();
    expect(await findMembershipInviteByToken(issued.token)).toEqual({
      state: "valid",
      email,
      inviterName: "Sam Owner",
      planName: "Couples Premium",
    });
  });

  it("reports accepted, revoked, expired (marking it), and unknown invites", async () => {
    const accepted = await pendingInvite();
    await accept(accepted.partner, accepted.issued.token);
    expect(await findMembershipInviteByToken(accepted.issued.token)).toEqual({ state: "accepted" });

    const revoked = await pendingInvite();
    await revokeMembershipInvite({ actorId: revoked.owner.id, inviteId: revoked.issued.inviteId, ipHash: null });
    expect(await findMembershipInviteByToken(revoked.issued.token)).toEqual({ state: "revoked" });

    const expired = await pendingInvite();
    vi.setSystemTime(IN_SEVEN_DAYS);
    expect(await findMembershipInviteByToken(expired.issued.token)).toEqual({ state: "expired" });
    expect(await db.membershipInvite.findUniqueOrThrow({ where: { id: expired.issued.inviteId } })).toMatchObject({ status: "EXPIRED" });

    expect(await findMembershipInviteByToken("x".repeat(43))).toEqual({ state: "not_found" });
    expect(await findMembershipInviteByToken("../etc")).toEqual({ state: "not_found" });
  });

  it("reports an invite on a membership whose period is over as ended", async () => {
    const { membership, issued } = await pendingInvite();
    await db.membership.update({ where: { id: membership.id }, data: { currentPeriodEnd: at(HOUR) } });
    vi.setSystemTime(at(2 * HOUR));

    expect(await findMembershipInviteByToken(issued.token)).toEqual({ state: "ended" });
  });
});

describe("audit trail", () => {
  it("records the full couples flow", async () => {
    const { owner, issued, partner } = await pendingInvite();
    const { seatId } = await accept(partner, issued.token);
    await removePartner({ actorId: owner.id, seatId, ipHash: null });

    expect(await auditActions()).toEqual([
      "membership_invite.created",
      "membership_invite.accepted",
      "membership.partner_joined",
      "membership.partner_removed",
    ]);
  });
});
