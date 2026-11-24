import "server-only";
import { z } from "zod";
import type { Payment } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/services/audit";
import { MembershipError } from "./errors";
import {
  endMembership,
  endOverdueMemberships,
  lockMembership,
  lockUsers,
  requireActiveAdmin,
  VALID_PAYMENT_STATUSES,
  type CleanupTrigger,
  type LockedMembership,
  type Tx,
} from "./internal";
import { isEnded, overdueEndStatus } from "./rules";
import { ipHashSchema, reasonSchema, userIdSchema } from "./schemas";

const voidInput = z.object({
  actorId: userIdSchema,
  paymentId: z.uuid(),
  reason: reasonSchema,
  ipHash: ipHashSchema,
});

const refundInput = voidInput.extend({ amountCents: z.number().int() });

export type VoidPaymentInput = z.input<typeof voidInput>;
export type RefundPaymentInput = z.input<typeof refundInput>;

/** What a correction did to the payment's membership. */
export type CorrectionEffect =
  | { membership: "unchanged" }
  | { membership: "rolled_back"; previousEnd: Date; newEnd: Date; expired: boolean }
  | { membership: "cancelled" };

export type PaymentCorrectionResult = {
  paymentId: string;
  membershipId: string;
  effect: CorrectionEffect;
};

type Correction = "void" | "refund";

const CLEANUP_TRIGGER: Readonly<Record<Correction, CleanupTrigger>> = {
  void: "payment_void",
  refund: "payment_refund",
};

type ManualPayment = Payment & { membershipId: string; periodStart: Date };

type CorrectionContext = {
  membership: LockedMembership;
  payment: ManualPayment;
};

type ActorContext = {
  actorId: string;
  ipHash: string | null;
  now: Date;
};

/**
 * Locks the actor and the payer, runs the payer's overdue cleanup, then locks the membership and
 * the payment row (lock order User -> Membership -> Payment). Stripe payments are `NOT_MANUAL`.
 */
async function lockCorrection(
  tx: Tx,
  paymentId: string,
  correction: Correction,
  { actorId, now }: ActorContext,
): Promise<CorrectionContext> {
  const target = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { userId: true, membershipId: true, method: true },
  });
  if (!target) throw new MembershipError("PAYMENT_NOT_FOUND");

  const users = await lockUsers(tx, [actorId, target.userId]);
  requireActiveAdmin(users, actorId);
  if (target.method === "STRIPE" || target.membershipId === null) throw new MembershipError("NOT_MANUAL");

  await endOverdueMemberships(tx, target.userId, now, CLEANUP_TRIGGER[correction]);
  const membership = await lockMembership(tx, target.membershipId);

  await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.membershipId === null || payment.periodStart === null) {
    throw new Error("A manual payment always belongs to a membership and covers a period");
  }
  return { membership, payment: { ...payment, membershipId: payment.membershipId, periodStart: payment.periodStart } };
}

/** Void and full refund apply only to the membership's valid payment with the newest period start. */
async function assertLatestValidPayment(tx: Tx, payment: ManualPayment): Promise<void> {
  const latest = await tx.payment.findFirst({
    where: { membershipId: payment.membershipId, status: { in: [...VALID_PAYMENT_STATUSES] } },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (latest?.id !== payment.id) throw new MembershipError("NOT_LATEST_PAYMENT");
}

/**
 * Takes the payment's period away from a running membership: rolls `currentPeriodEnd` back to the
 * payment's period start and cancels open freezes that would start at or after it, or cancels the
 * membership when the payment activated it. A rollback into the past ends the membership as
 * overdue cleanup would. An ended membership is left as is.
 */
async function withdrawPaidPeriod(
  tx: Tx,
  { membership, payment }: CorrectionContext,
  correction: Correction,
  { actorId, ipHash, now }: ActorContext,
): Promise<CorrectionEffect> {
  if (isEnded(membership)) return { membership: "unchanged" };

  if (payment.periodStart.getTime() <= membership.currentPeriodStart.getTime()) {
    await endMembership(tx, membership, {
      status: "CANCELLED",
      endedAt: now,
      now,
      via: correction,
      actorId,
      ipHash,
      details: { paymentId: payment.id },
    });
    return { membership: "cancelled" };
  }

  const previousEnd = membership.currentPeriodEnd;
  const newEnd = payment.periodStart;
  await tx.membership.update({ where: { id: membership.id }, data: { currentPeriodEnd: newEnd } });
  await audit(tx, {
    actorId,
    action: "membership.period_rolled_back",
    targetType: "membership",
    targetId: membership.id,
    details: { paymentId: payment.id, previousEnd: previousEnd.toISOString(), newEnd: newEnd.toISOString() },
    ipHash,
    createdAt: now,
  });

  const freezes = await tx.membershipFreeze.findMany({
    where: { membershipId: membership.id, status: { in: ["REQUESTED", "APPROVED"] }, startsAt: { gte: newEnd } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const freeze of freezes) {
    await tx.membershipFreeze.update({ where: { id: freeze.id }, data: { status: "CANCELLED" } });
    await audit(tx, {
      actorId,
      action: "membership_freeze.cancelled",
      targetType: "membership_freeze",
      targetId: freeze.id,
      details: { via: "period_rolled_back" },
      ipHash,
      createdAt: now,
    });
  }

  const expired = newEnd.getTime() <= now.getTime();
  if (expired) {
    await endMembership(tx, membership, {
      status: overdueEndStatus(membership),
      endedAt: newEnd,
      now,
      via: "overdue_cleanup",
      actorId: null,
      ipHash: null,
      details: { trigger: CLEANUP_TRIGGER[correction] },
    });
  }
  return { membership: "rolled_back", previousEnd, newEnd, expired };
}

/**
 * Voids a manual payment recorded by mistake: only a SUCCEEDED payment with nothing refunded, and
 * only the membership's latest valid payment. The paid period is withdrawn from a running
 * membership (rollback, or cancellation for the activating payment).
 */
export async function voidPayment(input: VoidPaymentInput): Promise<PaymentCorrectionResult> {
  const { actorId, paymentId, reason, ipHash } = voidInput.parse(input);
  const now = new Date();
  const actor: ActorContext = { actorId, ipHash, now };

  return db.$transaction(async (tx) => {
    const context = await lockCorrection(tx, paymentId, "void", actor);
    const { payment } = context;
    if (payment.status === "PARTIALLY_REFUNDED" || payment.status === "REFUNDED") throw new MembershipError("HAS_REFUND");
    if (payment.status !== "SUCCEEDED" || payment.amountRefundedCents !== 0) throw new MembershipError("PAYMENT_NOT_VALID");
    await assertLatestValidPayment(tx, payment);

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "VOIDED", voidedAt: now, voidedById: actorId, voidReason: reason },
    });
    await audit(tx, {
      actorId,
      action: "payment.voided",
      targetType: "payment",
      targetId: payment.id,
      details: { membershipId: payment.membershipId, amountCents: payment.amountCents },
      ipHash,
      createdAt: now,
    });

    const effect = await withdrawPaidPeriod(tx, context, "void", actor);
    return { paymentId: payment.id, membershipId: payment.membershipId, effect };
  });
}

/**
 * Records the one manual refund a SUCCEEDED payment can get, of 1 cent up to its amount. A partial
 * refund changes amounts only. A full refund is allowed only on the membership's latest valid
 * payment and withdraws its paid period like a void.
 */
export async function refundPayment(input: RefundPaymentInput): Promise<PaymentCorrectionResult> {
  const { actorId, paymentId, amountCents, reason, ipHash } = refundInput.parse(input);
  const now = new Date();
  const actor: ActorContext = { actorId, ipHash, now };

  return db.$transaction(async (tx) => {
    const context = await lockCorrection(tx, paymentId, "refund", actor);
    const { payment } = context;
    if (payment.status === "PARTIALLY_REFUNDED" || payment.status === "REFUNDED") {
      throw new MembershipError("ALREADY_REFUNDED");
    }
    if (payment.status !== "SUCCEEDED") throw new MembershipError("PAYMENT_NOT_VALID");
    if (amountCents < 1 || amountCents > payment.amountCents) throw new MembershipError("INVALID_AMOUNT");

    const full = amountCents === payment.amountCents;
    if (full) await assertLatestValidPayment(tx, payment);

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
        amountRefundedCents: amountCents,
        refundedAt: now,
        refundedById: actorId,
        refundReason: reason,
      },
    });
    await audit(tx, {
      actorId,
      action: "payment.refunded",
      targetType: "payment",
      targetId: payment.id,
      details: { membershipId: payment.membershipId, amountRefundedCents: amountCents, full },
      ipHash,
      createdAt: now,
    });

    const effect: CorrectionEffect = full ? await withdrawPaidPeriod(tx, context, "refund", actor) : { membership: "unchanged" };
    return { paymentId: payment.id, membershipId: payment.membershipId, effect };
  });
}
