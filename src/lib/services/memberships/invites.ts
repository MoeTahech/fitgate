import "server-only";
import { z } from "zod";
import type { InviteStatus, MembershipInvite, MembershipMember } from "@/generated/prisma/client";
import { emailSchema } from "@/lib/auth/schemas";
import { generateToken, sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { membershipInviteEmail, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { audit } from "@/lib/services/audit";
import { MembershipError, toMembershipError, type MembershipErrorCode } from "./errors";
import {
  approvedFreezes,
  authorizeOwnerOrAdmin,
  consumeRateLimit,
  DEFAULT_TIME_ZONE,
  endIfOverdue,
  endOverdueMemberships,
  lockMembership,
  lockUsers,
  openBaseSeat,
  requireActiveUser,
  type LockedMembership,
  type LockedUser,
  type Tx,
} from "./internal";
import { isEnded, isOverdue, isUsableAt } from "./rules";
import { ipHashSchema, userIdSchema } from "./schemas";

export const MEMBERSHIP_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const tokenSchema = z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/);

const createInput = z.object({
  ownerId: userIdSchema,
  membershipId: z.uuid(),
  email: emailSchema,
  ipHash: ipHashSchema,
});

const inviteActionInput = z.object({ actorId: userIdSchema, inviteId: z.uuid(), ipHash: ipHashSchema });

const acceptInput = z.object({ userId: userIdSchema, token: z.string(), ipHash: ipHashSchema });

const removeInput = z.object({ actorId: userIdSchema, seatId: z.uuid(), ipHash: ipHashSchema });

const leaveInput = z.object({ userId: userIdSchema, membershipId: z.uuid(), ipHash: ipHashSchema });

export type CreateMembershipInviteInput = z.input<typeof createInput>;
export type MembershipInviteActionInput = z.input<typeof inviteActionInput>;
export type AcceptMembershipInviteInput = z.input<typeof acceptInput>;
export type RemovePartnerInput = z.input<typeof removeInput>;
export type LeaveMembershipInput = z.input<typeof leaveInput>;

/** An invite just issued; `token` exists only here and in the emailed link. */
export type IssuedMembershipInvite = {
  inviteId: string;
  membershipId: string;
  email: string;
  token: string;
  expiresAt: Date;
  inviterName: string;
  planName: string;
};

export type AcceptMembershipInviteResult = { membershipId: string; inviteId: string; seatId: string };

export type SeatChangeResult = { membershipId: string; seatId: string };

/** Locks the owner, then the membership. Only the owner may call (`NOT_OWNER`). */
async function lockOwnedMembership(
  tx: Tx,
  membershipId: string,
  ownerId: string,
): Promise<{ owner: LockedUser; membership: LockedMembership }> {
  const target = await tx.membership.findUnique({ where: { id: membershipId }, select: { ownerId: true } });
  if (!target) throw new MembershipError("MEMBERSHIP_NOT_FOUND");
  if (target.ownerId !== ownerId) throw new MembershipError("NOT_OWNER");
  const owner = requireActiveUser(await lockUsers(tx, [ownerId]), ownerId);
  return { owner, membership: await lockMembership(tx, membershipId) };
}

/** Locks an invite row; the caller holds the lock on its membership. */
async function lockInvite(tx: Tx, inviteId: string): Promise<MembershipInvite> {
  await tx.$queryRaw`SELECT id FROM membership_invites WHERE id = ${inviteId}::uuid FOR UPDATE`;
  return tx.membershipInvite.findUniqueOrThrow({ where: { id: inviteId } });
}

function isPastExpiry(invite: Pick<MembershipInvite, "expiresAt">, now: Date): boolean {
  return invite.expiresAt.getTime() <= now.getTime();
}

function openSeatCount(tx: Tx, membershipId: string): Promise<number> {
  return tx.membershipMember.count({ where: { membershipId, endedAt: null } });
}

/** Ends a seat now (never before it began). */
async function endSeat(tx: Tx, seat: Pick<MembershipMember, "id" | "joinedAt">, now: Date): Promise<void> {
  const endedAt = new Date(Math.max(seat.joinedAt.getTime(), now.getTime()));
  await tx.membershipMember.update({ where: { id: seat.id }, data: { endedAt } });
}

/** A membership can take an invite while it is running and usable, on a shared plan, with a free seat. */
async function assertInvitable(tx: Tx, membership: LockedMembership, now: Date): Promise<void> {
  if (isEnded(membership) || isOverdue(membership, now)) throw new MembershipError("MEMBERSHIP_ENDED");
  if (membership.plan.maxMembers < 2) throw new MembershipError("NOT_COUPLES_PLAN");
  if (!isUsableAt(membership, await approvedFreezes(tx, membership.id), now)) {
    throw new MembershipError("MEMBERSHIP_NOT_USABLE");
  }
  if ((await openSeatCount(tx, membership.id)) >= membership.plan.maxMembers) throw new MembershipError("NO_FREE_SEAT");
}

type IssueInput = {
  owner: LockedUser;
  membership: LockedMembership;
  email: string;
  now: Date;
  ipHash: string | null;
  resentFromId?: string;
};

/**
 * Marks the membership's lapsed pending invite EXPIRED, revokes a still-pending one (superseded),
 * and issues a new invite valid 7 days. Whether the email belongs to an account or holds a seat
 * is deliberately not checked (decision 10). The caller holds the owner and membership locks.
 */
async function issueInvite(tx: Tx, input: IssueInput): Promise<IssuedMembershipInvite> {
  const { owner, membership, email, now, ipHash, resentFromId } = input;
  if (email === owner.email) throw new MembershipError("INVITE_OWN_EMAIL");

  await tx.membershipInvite.updateMany({
    where: { membershipId: membership.id, status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  const pending = await tx.membershipInvite.findMany({
    where: { membershipId: membership.id, status: "PENDING" },
    select: { id: true },
  });
  for (const { id } of pending) {
    await tx.membershipInvite.update({
      where: { id },
      data: { status: "REVOKED", revokedAt: now, revokedById: owner.id },
    });
    await audit(tx, {
      actorId: owner.id,
      action: "membership_invite.revoked",
      targetType: "membership_invite",
      targetId: id,
      details: { membershipId: membership.id, via: "superseded" },
      ipHash,
      createdAt: now,
    });
  }

  const token = generateToken();
  const invite = await tx.membershipInvite.create({
    data: {
      membershipId: membership.id,
      email,
      tokenHash: sha256(token),
      invitedById: owner.id,
      status: "PENDING",
      createdAt: now,
      expiresAt: new Date(now.getTime() + MEMBERSHIP_INVITE_TTL_MS),
    },
  });
  await audit(tx, {
    actorId: owner.id,
    action: "membership_invite.created",
    targetType: "membership_invite",
    targetId: invite.id,
    details: { membershipId: membership.id, ...(resentFromId ? { resentFromId } : {}) },
    ipHash,
    createdAt: now,
  });

  const { name } = await tx.user.findUniqueOrThrow({ where: { id: owner.id }, select: { name: true } });
  return {
    inviteId: invite.id,
    membershipId: membership.id,
    email,
    token,
    expiresAt: invite.expiresAt,
    inviterName: name,
    planName: membership.plan.name,
  };
}

/**
 * The owner invites a partner by email onto a running, usable membership on a shared plan with a
 * free seat. A previous pending invite is revoked. The response never depends on the email's
 * account or seats. Counts toward `membershipInvite` (with resends), checked before the
 * transaction. Send the email with `sendMembershipInvite` after this returns.
 */
export async function createMembershipInvite(input: CreateMembershipInviteInput): Promise<IssuedMembershipInvite> {
  const { ownerId, membershipId, email, ipHash } = createInput.parse(input);
  await consumeRateLimit("membershipInvite", ownerId);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const { owner, membership } = await lockOwnedMembership(tx, membershipId, ownerId);
    await assertInvitable(tx, membership, now);
    return issueInvite(tx, { owner, membership, email, now, ipHash });
  });
}

/**
 * The owner sends a pending or expired invite again: it is replaced by a new invite (new token,
 * 7 days) for the same email. Counts toward `membershipInvite`.
 */
export async function resendMembershipInvite(input: MembershipInviteActionInput): Promise<IssuedMembershipInvite> {
  const { actorId, inviteId, ipHash } = inviteActionInput.parse(input);
  await consumeRateLimit("membershipInvite", actorId);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const target = await tx.membershipInvite.findUnique({ where: { id: inviteId }, select: { membershipId: true } });
    if (!target) throw new MembershipError("INVITE_NOT_FOUND");
    const { owner, membership } = await lockOwnedMembership(tx, target.membershipId, actorId);
    const invite = await lockInvite(tx, inviteId);
    if (invite.status !== "PENDING" && invite.status !== "EXPIRED") throw new MembershipError("INVITE_NOT_PENDING");

    await assertInvitable(tx, membership, now);
    return issueInvite(tx, { owner, membership, email: invite.email, now, ipHash, resentFromId: invite.id });
  });
}

/** The owner or an admin revokes a pending invite that hasn't expired. */
export async function revokeMembershipInvite(input: MembershipInviteActionInput): Promise<{ inviteId: string; membershipId: string }> {
  const { actorId, inviteId, ipHash } = inviteActionInput.parse(input);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const target = await tx.membershipInvite.findUnique({
      where: { id: inviteId },
      select: { membership: { select: { id: true, ownerId: true } } },
    });
    if (!target) throw new MembershipError("INVITE_NOT_FOUND");
    const { id: membershipId, ownerId } = target.membership;

    const via = authorizeOwnerOrAdmin(await lockUsers(tx, [actorId, ownerId]), ownerId, actorId);
    await lockMembership(tx, membershipId);
    const invite = await lockInvite(tx, inviteId);
    if (invite.status !== "PENDING" || isPastExpiry(invite, now)) throw new MembershipError("INVITE_NOT_PENDING");

    await tx.membershipInvite.update({
      where: { id: invite.id },
      data: { status: "REVOKED", revokedAt: now, revokedById: actorId },
    });
    await audit(tx, {
      actorId,
      action: "membership_invite.revoked",
      targetType: "membership_invite",
      targetId: invite.id,
      details: { membershipId, via },
      ipHash,
      createdAt: now,
    });
    return { inviteId: invite.id, membershipId };
  });
}

type AcceptOutcome = { ok: true; result: AcceptMembershipInviteResult } | { ok: false; code: MembershipErrorCode };

/**
 * The invited person joins the membership with a PARTNER seat. The invite must be pending and
 * unexpired, and the accepter's verified email must match it. Runs overdue cleanup for the
 * accepter first; an overdue membership is ended and the accept fails. Then a seat must be free
 * and the accepter must not hold a base seat (`HAS_ACTIVE_BASE`). Failures that record a change
 * (an invite found expired, an overdue membership ended) commit it before throwing.
 */
export async function acceptMembershipInvite(input: AcceptMembershipInviteInput): Promise<AcceptMembershipInviteResult> {
  const { userId, token, ipHash } = acceptInput.parse(input);
  if (!tokenSchema.safeParse(token).success) throw new MembershipError("INVITE_NOT_FOUND");
  const now = new Date();

  let outcome: AcceptOutcome;
  try {
    outcome = await db.$transaction(async (tx): Promise<AcceptOutcome> => {
      const fail = (code: MembershipErrorCode): AcceptOutcome => ({ ok: false, code });

      const user = requireActiveUser(await lockUsers(tx, [userId]), userId);
      const target = await tx.membershipInvite.findUnique({
        where: { tokenHash: sha256(token) },
        select: { id: true, membershipId: true },
      });
      if (!target) return fail("INVITE_NOT_FOUND");

      await endOverdueMemberships(tx, userId, now, "invite_accept");
      const membership = await lockMembership(tx, target.membershipId);
      const invite = await lockInvite(tx, target.id);

      if (invite.status === "ACCEPTED") return fail("INVITE_ALREADY_ACCEPTED");
      if (invite.status === "REVOKED") return fail(invite.revokedById === null ? "MEMBERSHIP_ENDED" : "INVITE_REVOKED");
      if (invite.status === "EXPIRED") return fail("INVITE_EXPIRED");
      if (isPastExpiry(invite, now)) {
        await tx.membershipInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
        return fail("INVITE_EXPIRED");
      }
      if (!user.emailVerified) return fail("EMAIL_NOT_VERIFIED");
      if (user.email !== invite.email) return fail("EMAIL_MISMATCH");
      if (membership.ownerId === user.id) return fail("OWN_MEMBERSHIP");

      if (isEnded(membership) || (await endIfOverdue(tx, membership, now, "invite_accept"))) return fail("MEMBERSHIP_ENDED");
      if ((await openSeatCount(tx, membership.id)) >= membership.plan.maxMembers) return fail("NO_FREE_SEAT");
      if (membership.plan.type === "BASE" && (await openBaseSeat(tx, user.id))) return fail("HAS_ACTIVE_BASE");

      const seat = await tx.membershipMember.create({
        data: { membershipId: membership.id, userId: user.id, role: "PARTNER", planType: membership.plan.type, joinedAt: now },
        select: { id: true },
      });
      await tx.membershipInvite.update({
        where: { id: invite.id },
        data: { status: "ACCEPTED", acceptedAt: now, acceptedById: user.id },
      });
      await audit(tx, {
        actorId: user.id,
        action: "membership_invite.accepted",
        targetType: "membership_invite",
        targetId: invite.id,
        details: { membershipId: membership.id },
        ipHash,
        createdAt: now,
      });
      await audit(tx, {
        actorId: user.id,
        action: "membership.partner_joined",
        targetType: "membership",
        targetId: membership.id,
        details: { seatId: seat.id, inviteId: invite.id },
        ipHash,
        createdAt: now,
      });

      return { ok: true, result: { membershipId: membership.id, inviteId: invite.id, seatId: seat.id } };
    });
  } catch (error) {
    throw toMembershipError(error);
  }

  if (!outcome.ok) throw new MembershipError(outcome.code);
  return outcome.result;
}

/** The owner or an admin ends the partner's seat on a running membership, freeing it for a new invite. */
export async function removePartner(input: RemovePartnerInput): Promise<SeatChangeResult> {
  const { actorId, seatId, ipHash } = removeInput.parse(input);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const target = await tx.membershipMember.findUnique({
      where: { id: seatId },
      select: { userId: true, role: true, membership: { select: { id: true, ownerId: true } } },
    });
    if (!target || target.role !== "PARTNER") throw new MembershipError("PARTNER_NOT_FOUND");
    const { id: membershipId, ownerId } = target.membership;

    const via = authorizeOwnerOrAdmin(await lockUsers(tx, [actorId, ownerId, target.userId]), ownerId, actorId);
    const membership = await lockMembership(tx, membershipId);
    const seat = await tx.membershipMember.findUniqueOrThrow({ where: { id: seatId } });
    if (seat.endedAt !== null) throw new MembershipError("PARTNER_NOT_FOUND");
    if (isEnded(membership) || isOverdue(membership, now)) throw new MembershipError("MEMBERSHIP_ENDED");

    await endSeat(tx, seat, now);
    await audit(tx, {
      actorId,
      action: "membership.partner_removed",
      targetType: "membership",
      targetId: membershipId,
      details: { seatId, via },
      ipHash,
      createdAt: now,
    });
    return { membershipId, seatId };
  });
}

/** The partner leaves a running membership, ending their seat. */
export async function leaveMembership(input: LeaveMembershipInput): Promise<SeatChangeResult> {
  const { userId, membershipId, ipHash } = leaveInput.parse(input);
  const now = new Date();

  return db.$transaction(async (tx) => {
    requireActiveUser(await lockUsers(tx, [userId]), userId);
    const membership = await lockMembership(tx, membershipId);
    const seat = await tx.membershipMember.findFirst({
      where: { membershipId, userId, role: "PARTNER", endedAt: null },
    });
    if (!seat) throw new MembershipError("PARTNER_NOT_FOUND");
    if (isEnded(membership) || isOverdue(membership, now)) throw new MembershipError("MEMBERSHIP_ENDED");

    await endSeat(tx, seat, now);
    await audit(tx, {
      actorId: userId,
      action: "membership.partner_left",
      targetType: "membership",
      targetId: membershipId,
      details: { seatId: seat.id },
      ipHash,
      createdAt: now,
    });
    return { membershipId, seatId: seat.id };
  });
}

export type MembershipInviteLookup =
  | { state: "valid"; email: string; inviterName: string; planName: string }
  | { state: "expired" | "revoked" | "accepted" | "ended" | "not_found" };

const LOOKUP_STATES: Record<Exclude<InviteStatus, "PENDING">, Exclude<MembershipInviteLookup["state"], "valid">> = {
  ACCEPTED: "accepted",
  REVOKED: "revoked",
  EXPIRED: "expired",
};

/**
 * Public lookup for the accept page by token; marks the invite EXPIRED if its time has passed.
 * An invite revoked by the system, or on a membership whose period is over, reads as `ended`.
 */
export async function findMembershipInviteByToken(token: string): Promise<MembershipInviteLookup> {
  if (!tokenSchema.safeParse(token).success) return { state: "not_found" };
  const tokenHash = sha256(token);
  const now = new Date();

  await db.membershipInvite.updateMany({
    where: { tokenHash, status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  const invite = await db.membershipInvite.findUnique({
    where: { tokenHash },
    select: {
      email: true,
      status: true,
      revokedById: true,
      invitedBy: { select: { name: true } },
      membership: { include: { plan: true } },
    },
  });
  if (!invite) return { state: "not_found" };
  if (invite.status === "REVOKED" && invite.revokedById === null) return { state: "ended" };
  if (invite.status !== "PENDING") return { state: LOOKUP_STATES[invite.status] };
  if (isEnded(invite.membership) || isOverdue(invite.membership, now)) return { state: "ended" };
  return { state: "valid", email: invite.email, inviterName: invite.invitedBy.name, planName: invite.membership.plan.name };
}

export function membershipInviteUrl(token: string): string {
  return `${env.BETTER_AUTH_URL}/invite/membership/${token}`;
}

/** Sends the invite email after the transaction committed. Returns false if delivery failed. */
export async function sendMembershipInvite(invite: IssuedMembershipInvite): Promise<boolean> {
  const settings = await db.gymSettings.findUnique({ where: { id: 1 }, select: { timeZone: true } });
  try {
    await sendEmail({
      to: invite.email,
      ...membershipInviteEmail({
        url: membershipInviteUrl(invite.token),
        inviterName: invite.inviterName,
        planName: invite.planName,
        expiresAt: invite.expiresAt,
        timeZone: settings?.timeZone ?? DEFAULT_TIME_ZONE,
      }),
    });
    return true;
  } catch {
    return false;
  }
}
