import "server-only";
import { z } from "zod";
import type { FreezeStatus, MembershipFreeze } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/services/audit";
import { addDaysZoned, startOfZonedDay, zonedParts, type LocalDate } from "@/lib/time";
import { MembershipError, toMembershipError, type FreezeDatesDetails } from "./errors";
import {
  authorizeOwnerOrAdmin,
  getGymClock,
  lockMembership,
  lockUsers,
  requireActiveAdmin,
  requireActiveUser,
  VALID_PAYMENT_STATUSES,
  type LockedMembership,
  type LockedUser,
  type Tx,
} from "./internal";
import { isEnded, isOverdue } from "./rules";
import { FREEZE_LEAD_DAYS, ipHashSchema, localDateSchema, MAX_FREEZE_DAYS, noteSchema, userIdSchema } from "./schemas";

export { FREEZE_LEAD_DAYS, MAX_FREEZE_DAYS };

const OPEN_STATUSES: readonly FreezeStatus[] = ["REQUESTED", "APPROVED"];

const requestInput = z.object({
  userId: userIdSchema,
  membershipId: z.uuid(),
  firstDay: localDateSchema,
  lastDay: localDateSchema,
  ipHash: ipHashSchema,
});

const decisionInput = z.object({
  actorId: userIdSchema,
  freezeId: z.uuid(),
  ipHash: ipHashSchema,
});

const rejectInput = decisionInput.extend({ reason: noteSchema });

export type RequestFreezeInput = z.input<typeof requestInput>;
export type ApproveFreezeInput = z.input<typeof decisionInput>;
export type RejectFreezeInput = z.input<typeof rejectInput>;
export type CancelFreezeInput = z.input<typeof decisionInput>;

export type PeriodShift = { previousEnd: Date; newEnd: Date };

export type FreezeResult = {
  freezeId: string;
  membershipId: string;
  status: FreezeStatus;
  startsAt: Date;
  endsAt: Date;
  /** How approval or the cancellation of an approved freeze moved the period end. */
  periodShift: PeriodShift | null;
};

function invalidDates(reason: FreezeDatesDetails["reason"]): MembershipError {
  return new MembershipError("INVALID_FREEZE_DATES", { reason });
}

/** `days` local days after `date`; `startOfZonedDay` rolls an out-of-range day over into the next month. */
function laterDay(date: LocalDate, days: number): LocalDate {
  return { year: date.year, month: date.month, day: date.day + days };
}

/**
 * The freeze window for whole local days `firstDay` to `lastDay` (inclusive): from the start of
 * the first day to the start of the day after the last. 1 to 30 days, starting no earlier than
 * the day after tomorrow.
 */
function freezeWindow(firstDay: LocalDate, lastDay: LocalDate, now: Date, timeZone: string): { startsAt: Date; endsAt: Date } {
  const startsAt = startOfZonedDay(firstDay, timeZone);
  const endsAt = startOfZonedDay(laterDay(lastDay, 1), timeZone);
  if (endsAt.getTime() <= startsAt.getTime()) throw invalidDates("END_BEFORE_START");
  if (endsAt.getTime() > startOfZonedDay(laterDay(firstDay, MAX_FREEZE_DAYS), timeZone).getTime()) {
    throw invalidDates("TOO_LONG");
  }
  const earliestDay = zonedParts(addDaysZoned(now, FREEZE_LEAD_DAYS, timeZone), timeZone);
  if (startsAt.getTime() < startOfZonedDay(earliestDay, timeZone).getTime()) throw invalidDates("TOO_SOON");
  return { startsAt, endsAt };
}

/**
 * Freezes apply to running manual memberships on recurring base plans. Stripe subscriptions
 * need a paused subscription in Stripe and come with the Stripe milestone.
 */
function assertFreezable(membership: LockedMembership, now: Date): void {
  if (isEnded(membership) || isOverdue(membership, now)) throw new MembershipError("MEMBERSHIP_ENDED");
  const { source, status, plan } = membership;
  if (source !== "MANUAL" || status !== "ACTIVE" || plan.type !== "BASE" || plan.billing !== "RECURRING") {
    throw new MembershipError("NOT_FREEZABLE");
  }
}

function assertStartsBeforePeriodEnd(membership: LockedMembership, startsAt: Date): void {
  if (startsAt.getTime() >= membership.currentPeriodEnd.getTime()) throw invalidDates("AFTER_PERIOD_END");
}

/** Approval, rejection, and cancellation apply only to open freezes that haven't started. */
function assertOpenAndFuture(freeze: MembershipFreeze, now: Date, statuses: readonly FreezeStatus[]): void {
  if (!statuses.includes(freeze.status)) throw new MembershipError("FREEZE_NOT_OPEN");
  if (freeze.startsAt.getTime() <= now.getTime()) throw new MembershipError("FREEZE_STARTED");
}

/**
 * Settles the membership's freezes whose dates have passed: a request whose start passed
 * undecided lapses (`CANCELLED`), and an approved freeze that is over is `COMPLETED`.
 */
async function settleFreezes(tx: Tx, membershipId: string, now: Date): Promise<void> {
  const lapsed = await tx.membershipFreeze.findMany({
    where: { membershipId, status: "REQUESTED", startsAt: { lte: now } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const freeze of lapsed) {
    await tx.membershipFreeze.update({ where: { id: freeze.id }, data: { status: "CANCELLED" } });
    await audit(tx, {
      actorId: null,
      action: "membership_freeze.cancelled",
      targetType: "membership_freeze",
      targetId: freeze.id,
      details: { membershipId, via: "lapsed" },
      createdAt: now,
    });
  }
  await tx.membershipFreeze.updateMany({
    where: { membershipId, status: "APPROVED", endsAt: { lte: now } },
    data: { status: "COMPLETED" },
  });
}

/**
 * Moves the paid time from `from` on by `shiftMs` (negative to undo a shift): the period end,
 * and the covered periods of the valid payments, so a later rollback lands on a shifted boundary.
 */
async function shiftPaidTime(tx: Tx, membership: LockedMembership, from: Date, shiftMs: number): Promise<PeriodShift> {
  const shift = (instant: Date) => new Date(instant.getTime() + shiftMs);
  const previousEnd = membership.currentPeriodEnd;
  const newEnd = shift(previousEnd);
  await tx.membership.update({ where: { id: membership.id }, data: { currentPeriodEnd: newEnd } });

  const payments = await tx.payment.findMany({
    where: { membershipId: membership.id, status: { in: [...VALID_PAYMENT_STATUSES] }, periodEnd: { gt: from } },
    select: { id: true, periodStart: true, periodEnd: true },
    orderBy: { id: "asc" },
  });
  for (const payment of payments) {
    const { periodStart, periodEnd } = payment;
    if (periodEnd === null) continue;
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        periodEnd: shift(periodEnd),
        ...(periodStart !== null && periodStart.getTime() >= from.getTime() ? { periodStart: shift(periodStart) } : {}),
      },
    });
  }
  return { previousEnd, newEnd };
}

type LockedFreeze = {
  users: LockedUser[];
  membership: LockedMembership;
  freeze: MembershipFreeze;
};

/** Locks the actor and the owner, then the membership, then the freeze row (lock order User -> Membership -> Freeze). */
async function lockFreeze(tx: Tx, freezeId: string, actorId: string): Promise<LockedFreeze> {
  const target = await tx.membershipFreeze.findUnique({
    where: { id: freezeId },
    select: { membership: { select: { id: true, ownerId: true } } },
  });
  if (!target) throw new MembershipError("FREEZE_NOT_FOUND");

  const users = await lockUsers(tx, [actorId, target.membership.ownerId]);
  const membership = await lockMembership(tx, target.membership.id);
  await tx.$queryRaw`SELECT id FROM membership_freezes WHERE id = ${freezeId}::uuid FOR UPDATE`;
  const freeze = await tx.membershipFreeze.findUniqueOrThrow({ where: { id: freezeId } });
  return { users, membership, freeze };
}

function freezeResult(freeze: MembershipFreeze, status: FreezeStatus, periodShift: PeriodShift | null): FreezeResult {
  return {
    freezeId: freeze.id,
    membershipId: freeze.membershipId,
    status,
    startsAt: freeze.startsAt,
    endsAt: freeze.endsAt,
    periodShift,
  };
}

function shiftDetails(periodShift: PeriodShift | null) {
  return periodShift
    ? { previousEnd: periodShift.previousEnd.toISOString(), newEnd: periodShift.newEnd.toISOString() }
    : {};
}

/**
 * The owner requests a freeze of whole local days `firstDay` to `lastDay` (inclusive) on a running
 * manual membership on a recurring base plan. It must last 1 to 30 days, start no earlier than the
 * day after tomorrow and before the period end, and no other freeze may be open.
 */
export async function requestFreeze(input: RequestFreezeInput): Promise<FreezeResult> {
  const { userId, membershipId, firstDay, lastDay, ipHash } = requestInput.parse(input);
  const now = new Date();

  try {
    return await db.$transaction(async (tx) => {
      const target = await tx.membership.findUnique({ where: { id: membershipId }, select: { ownerId: true } });
      if (!target) throw new MembershipError("MEMBERSHIP_NOT_FOUND");
      if (target.ownerId !== userId) throw new MembershipError("NOT_OWNER");

      requireActiveUser(await lockUsers(tx, [userId]), userId);
      const membership = await lockMembership(tx, membershipId);
      assertFreezable(membership, now);

      const { timeZone } = await getGymClock(tx);
      const { startsAt, endsAt } = freezeWindow(firstDay, lastDay, now, timeZone);
      assertStartsBeforePeriodEnd(membership, startsAt);

      await settleFreezes(tx, membershipId, now);
      const open = await tx.membershipFreeze.findFirst({
        where: { membershipId, status: { in: [...OPEN_STATUSES] } },
        select: { id: true },
      });
      if (open) throw new MembershipError("FREEZE_ALREADY_OPEN");

      const freeze = await tx.membershipFreeze.create({
        data: { membershipId, requestedById: userId, status: "REQUESTED", startsAt, endsAt, createdAt: now },
      });
      await audit(tx, {
        actorId: userId,
        action: "membership_freeze.requested",
        targetType: "membership_freeze",
        targetId: freeze.id,
        details: { membershipId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        ipHash,
        createdAt: now,
      });
      return freezeResult(freeze, "REQUESTED", null);
    });
  } catch (error) {
    throw toMembershipError(error);
  }
}

/**
 * An admin approves a requested freeze before it starts. The stored status stays ACTIVE; the
 * period end and the covered periods of valid payments from the freeze start on move back by the
 * freeze length, and the membership is not usable inside the window.
 */
export async function approveFreeze(input: ApproveFreezeInput): Promise<FreezeResult> {
  const { actorId, freezeId, ipHash } = decisionInput.parse(input);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const { users, membership, freeze } = await lockFreeze(tx, freezeId, actorId);
    requireActiveAdmin(users, actorId);
    assertOpenAndFuture(freeze, now, ["REQUESTED"]);
    assertFreezable(membership, now);
    assertStartsBeforePeriodEnd(membership, freeze.startsAt);

    await tx.membershipFreeze.update({
      where: { id: freeze.id },
      data: { status: "APPROVED", decidedById: actorId, decidedAt: now },
    });
    const periodShift = await shiftPaidTime(tx, membership, freeze.startsAt, freeze.endsAt.getTime() - freeze.startsAt.getTime());
    await audit(tx, {
      actorId,
      action: "membership_freeze.approved",
      targetType: "membership_freeze",
      targetId: freeze.id,
      details: { membershipId: membership.id, ...shiftDetails(periodShift) },
      ipHash,
      createdAt: now,
    });
    return freezeResult(freeze, "APPROVED", periodShift);
  });
}

/** An admin rejects a requested freeze before it starts, with an optional reason (not audited). */
export async function rejectFreeze(input: RejectFreezeInput): Promise<FreezeResult> {
  const { actorId, freezeId, reason, ipHash } = rejectInput.parse(input);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const { users, membership, freeze } = await lockFreeze(tx, freezeId, actorId);
    requireActiveAdmin(users, actorId);
    assertOpenAndFuture(freeze, now, ["REQUESTED"]);

    await tx.membershipFreeze.update({
      where: { id: freeze.id },
      data: { status: "REJECTED", decidedById: actorId, decidedAt: now, reason },
    });
    await audit(tx, {
      actorId,
      action: "membership_freeze.rejected",
      targetType: "membership_freeze",
      targetId: freeze.id,
      details: { membershipId: membership.id },
      ipHash,
      createdAt: now,
    });
    return freezeResult(freeze, "REJECTED", null);
  });
}

/**
 * The owner or an admin cancels a requested or approved freeze before it starts. Cancelling an
 * approved freeze undoes its shift of the period end and the payment periods.
 */
export async function cancelFreeze(input: CancelFreezeInput): Promise<FreezeResult> {
  const { actorId, freezeId, ipHash } = decisionInput.parse(input);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const { users, membership, freeze } = await lockFreeze(tx, freezeId, actorId);
    const via = authorizeOwnerOrAdmin(users, membership.ownerId, actorId);
    assertOpenAndFuture(freeze, now, OPEN_STATUSES);

    let periodShift: PeriodShift | null = null;
    if (freeze.status === "APPROVED") {
      if (isEnded(membership) || isOverdue(membership, now)) throw new MembershipError("MEMBERSHIP_ENDED");
      periodShift = await shiftPaidTime(tx, membership, freeze.startsAt, freeze.startsAt.getTime() - freeze.endsAt.getTime());
    }

    await tx.membershipFreeze.update({ where: { id: freeze.id }, data: { status: "CANCELLED" } });
    await audit(tx, {
      actorId,
      action: "membership_freeze.cancelled",
      targetType: "membership_freeze",
      targetId: freeze.id,
      details: { membershipId: membership.id, via, previousStatus: freeze.status, ...shiftDetails(periodShift) },
      ipHash,
      createdAt: now,
    });
    return freezeResult(freeze, "CANCELLED", periodShift);
  });
}
