import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Membership, MembershipMember, MembershipStatus, Plan } from "@/generated/prisma/client";
import type { AppRole } from "@/lib/auth/constants";
import { audit } from "@/lib/services/audit";
import { MembershipError, type OpenBaseConflictDetails } from "./errors";
import { isOverdue, overdueEndStatus, remainingUsableMs, type FreezeWindow, type GymClock } from "./rules";

export type Tx = Prisma.TransactionClient;

const DAY_MS = 86_400_000;
export const DEFAULT_TIME_ZONE = "Asia/Beirut";

// ─── Locks ───────────────────────────────────────────────────────────────────

export type LockedUser = {
  id: string;
  role: AppRole;
  email: string;
  emailVerified: boolean;
  anonymizedAt: Date | null;
};

/** Locks the users in id order (the first step of the lock order). Missing ids are absent from the result. */
export async function lockUsers(tx: Tx, ids: readonly string[]): Promise<LockedUser[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  return tx.$queryRaw<LockedUser[]>`
    SELECT id, role::text AS role, email, email_verified AS "emailVerified", anonymized_at AS "anonymizedAt"
    FROM users
    WHERE id IN (${Prisma.join(unique)})
    ORDER BY id
    FOR UPDATE
  `;
}

/** The actor among the locked rows, if still an admin and not anonymized. */
export function requireActiveAdmin(rows: readonly LockedUser[], actorId: string): LockedUser {
  const actor = rows.find((row) => row.id === actorId);
  if (!actor || actor.role !== "ADMIN" || actor.anonymizedAt) throw new MembershipError("ACTOR_NOT_ADMIN");
  return actor;
}

/** The user among the locked rows, if it exists and is not anonymized. */
export function requireActiveUser(rows: readonly LockedUser[], userId: string): LockedUser {
  const user = rows.find((row) => row.id === userId);
  if (!user) throw new MembershipError("USER_NOT_FOUND");
  if (user.anonymizedAt) throw new MembershipError("USER_ANONYMIZED");
  return user;
}

export type LockedMembership = Membership & { plan: Plan };

/** Locks the memberships in id order, after the users, and loads them with their plans. */
export async function lockMemberships(tx: Tx, ids: readonly string[]): Promise<LockedMembership[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id
    FROM memberships
    WHERE id IN (${Prisma.join(unique.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id
    FOR UPDATE
  `;
  if (locked.length === 0) return [];
  return tx.membership.findMany({
    where: { id: { in: locked.map((row) => row.id) } },
    include: { plan: true },
    orderBy: { id: "asc" },
  });
}

export async function lockMembership(tx: Tx, id: string): Promise<LockedMembership> {
  const [membership] = await lockMemberships(tx, [id]);
  if (!membership) throw new MembershipError("MEMBERSHIP_NOT_FOUND");
  return membership;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** The gym's time zone and opening hours; the time zone falls back to Asia/Beirut. */
export async function getGymClock(tx: Tx): Promise<GymClock> {
  const settings = await tx.gymSettings.findUnique({ where: { id: 1 }, select: { timeZone: true } });
  const openingHours = await tx.openingHours.findMany({
    select: { weekday: true, opensAtMin: true, closesAtMin: true },
    orderBy: { weekday: "asc" },
  });
  return { timeZone: settings?.timeZone ?? DEFAULT_TIME_ZONE, openingHours };
}

/** The freezes that take time out of a membership: approved ones and settled (completed) ones. */
export function approvedFreezes(tx: Tx, membershipId: string): Promise<FreezeWindow[]> {
  return tx.membershipFreeze.findMany({
    where: { membershipId, status: { in: ["APPROVED", "COMPLETED"] } },
    select: { status: true, startsAt: true, endsAt: true },
  });
}

export type OpenBaseSeat = MembershipMember & { membership: LockedMembership };

/** The person's open BASE seat with its membership and plan, if any. Not locked. */
export function openBaseSeat(tx: Tx, userId: string): Promise<OpenBaseSeat | null> {
  return tx.membershipMember.findFirst({
    where: { userId, planType: "BASE", endedAt: null },
    include: { membership: { include: { plan: true } } },
  });
}

export type PaidAccessHistory = { openAccess: boolean; classAccess: boolean };

/**
 * Whether the person ever held a seat (open or ended, as owner or partner) on a paid membership
 * with open access, and on one with class access. Trials don't count, nor do manual memberships
 * whose payments were all voided.
 */
export async function paidAccessHistory(tx: Tx, userId: string): Promise<PaidAccessHistory> {
  const seats = await tx.membershipMember.findMany({
    where: {
      userId,
      membership: {
        source: { not: "TRIAL" },
        OR: [{ source: "STRIPE" }, { payments: { some: { status: { not: "VOIDED" } } } }],
      },
    },
    select: { membership: { select: { plan: { select: { openAccess: true, classAccess: true } } } } },
  });
  return {
    openAccess: seats.some((seat) => seat.membership.plan.openAccess),
    classAccess: seats.some((seat) => seat.membership.plan.classAccess !== "NONE"),
  };
}

// ─── Ending memberships ──────────────────────────────────────────────────────

export type EndVia = "overdue_cleanup" | "superseded" | "switched" | "void" | "refund";

export type EndMembershipInput = {
  status: Extract<MembershipStatus, "CANCELLED" | "EXPIRED">;
  endedAt: Date;
  now: Date;
  via: EndVia;
  actorId: string | null;
  ipHash: string | null;
  details?: Prisma.InputJsonObject;
};

/**
 * Ends a locked membership: sets the terminal status, ends its open seats, revokes its pending
 * invites (by the system), and settles its open freezes (started approved ones complete, the
 * rest are cancelled). Audits `membership.ended` with `{ status, via, ...details }`.
 */
export async function endMembership(tx: Tx, membership: Pick<Membership, "id">, input: EndMembershipInput): Promise<void> {
  const { status, endedAt, now, via, actorId, ipHash } = input;
  const { id } = membership;

  await tx.membership.update({ where: { id }, data: { status, endedAt } });
  await audit(tx, {
    actorId,
    action: "membership.ended",
    targetType: "membership",
    targetId: id,
    details: { status, via, ...input.details },
    ipHash,
    createdAt: now,
  });

  await tx.$executeRaw`
    UPDATE membership_members
    SET ended_at = GREATEST(joined_at, ${endedAt})
    WHERE membership_id = ${id}::uuid AND ended_at IS NULL
  `;

  const invites = await tx.membershipInvite.findMany({ where: { membershipId: id, status: "PENDING" }, select: { id: true } });
  for (const invite of invites) {
    await tx.membershipInvite.update({
      where: { id: invite.id },
      data: { status: "REVOKED", revokedAt: now, revokedById: null },
    });
    await audit(tx, {
      actorId,
      action: "membership_invite.revoked",
      targetType: "membership_invite",
      targetId: invite.id,
      details: { via: "membership_ended" },
      ipHash,
      createdAt: now,
    });
  }

  const freezes = await tx.membershipFreeze.findMany({
    where: { membershipId: id, status: { in: ["REQUESTED", "APPROVED"] } },
    select: { id: true, status: true, startsAt: true },
  });
  for (const freeze of freezes) {
    if (freeze.status === "APPROVED" && freeze.startsAt.getTime() <= now.getTime()) {
      await tx.membershipFreeze.update({ where: { id: freeze.id }, data: { status: "COMPLETED" } });
      continue;
    }
    await tx.membershipFreeze.update({ where: { id: freeze.id }, data: { status: "CANCELLED" } });
    await audit(tx, {
      actorId,
      action: "membership_freeze.cancelled",
      targetType: "membership_freeze",
      targetId: freeze.id,
      details: { via: "membership_ended" },
      ipHash,
      createdAt: now,
    });
  }
}

export type CleanupTrigger = "manual_create" | "manual_extend" | "trial_start" | "invite_accept";

/**
 * Ends the overdue memberships the person holds an open seat on (`EXPIRED`, or `CANCELLED` when
 * set to cancel at period end, with `endedAt = currentPeriodEnd`). The caller holds the person's
 * user lock; the memberships are locked here in id order. Returns the ids it ended.
 */
export async function endOverdueMemberships(tx: Tx, userId: string, now: Date, trigger: CleanupTrigger): Promise<string[]> {
  const candidates = await tx.membership.findMany({
    where: {
      status: { notIn: ["CANCELLED", "EXPIRED"] },
      currentPeriodEnd: { lte: now },
      members: { some: { userId, endedAt: null } },
    },
    select: { id: true },
  });

  const ended: string[] = [];
  for (const membership of await lockMemberships(tx, candidates.map((row) => row.id))) {
    if (!isOverdue(membership, now)) continue;
    await endMembership(tx, membership, {
      status: overdueEndStatus(membership),
      endedAt: membership.currentPeriodEnd,
      now,
      via: "overdue_cleanup",
      actorId: null,
      ipHash: null,
      details: { trigger },
    });
    ended.push(membership.id);
  }
  return ended;
}

// ─── Replacing an open base (decision 13) ────────────────────────────────────

export type ResolveOpenBaseInput = {
  memberId: string;
  plan: Pick<Plan, "id" | "type" | "billing">;
  confirmSwitch: boolean;
  now: Date;
  actorId: string;
  ipHash: string | null;
};

export type OpenBaseResolution =
  | { action: "none" }
  | { action: "superseded" | "switched"; membershipId: string };

function isCalendarDayPlan(plan: Pick<Plan, "billing" | "durationMode">): boolean {
  return plan.billing === "ONE_TIME" && plan.durationMode === "CALENDAR_DAYS";
}

function openBaseConflict(details: OpenBaseConflictDetails): MembershipError {
  return new MembershipError("HAS_ACTIVE_BASE", details);
}

async function switchConflict(tx: Tx, membership: LockedMembership, now: Date): Promise<OpenBaseConflictDetails> {
  const freezes = await approvedFreezes(tx, membership.id);
  const partners = await tx.membershipMember.count({
    where: { membershipId: membership.id, role: "PARTNER", endedAt: null },
  });
  return {
    reason: "SWITCH_NEEDS_CONFIRMATION",
    remainingDays: Math.ceil(remainingUsableMs(membership, freezes, now) / DAY_MS),
    hasPartner: partners > 0,
  };
}

/**
 * Makes room for a new BASE membership when the member holds an open base seat:
 * - a trial or Day Pass the member owns is superseded by a recurring plan (ended now);
 * - a manual recurring membership the member owns is switched (ended now) with `confirmSwitch`;
 *   on the same plan `SAME_PLAN`;
 * - otherwise `HAS_ACTIVE_BASE`, with an `OpenBaseConflictDetails` reason.
 * The caller holds the member's user lock and has run overdue cleanup for the member.
 */
export async function resolveOpenBase(tx: Tx, input: ResolveOpenBaseInput): Promise<OpenBaseResolution> {
  const { memberId, plan, confirmSwitch, now, actorId, ipHash } = input;
  if (plan.type !== "BASE") return { action: "none" };

  const found = await openBaseSeat(tx, memberId);
  if (!found) return { action: "none" };
  await lockMembership(tx, found.membershipId);
  const seat = await openBaseSeat(tx, memberId);
  if (!seat) return { action: "none" };
  if (seat.membershipId !== found.membershipId) {
    throw new Error("Open base seat changed while the member's row was locked");
  }

  const open = seat.membership;
  if (seat.role !== "OWNER") throw openBaseConflict({ reason: "PARTNER_SEAT" });

  if (open.source === "TRIAL" || isCalendarDayPlan(open.plan)) {
    if (plan.billing !== "RECURRING") throw openBaseConflict({ reason: "DAY_PASS_OR_TRIAL" });
    await endMembership(tx, open, { status: "CANCELLED", endedAt: now, now, via: "superseded", actorId, ipHash });
    return { action: "superseded", membershipId: open.id };
  }

  if (open.source === "MANUAL" && open.plan.billing === "RECURRING") {
    if (open.planId === plan.id) throw new MembershipError("SAME_PLAN");
    if (!confirmSwitch) throw openBaseConflict(await switchConflict(tx, open, now));
    await endMembership(tx, open, {
      status: "CANCELLED",
      endedAt: now,
      now,
      via: "switched",
      actorId,
      ipHash,
      details: { fromPlanId: open.planId, toPlanId: plan.id },
    });
    return { action: "switched", membershipId: open.id };
  }

  throw openBaseConflict({ reason: open.source === "STRIPE" ? "STRIPE_BASE" : "ONE_TIME_BASE" });
}
