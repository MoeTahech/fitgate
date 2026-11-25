import "server-only";
import { z } from "zod";
import type { Plan } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/services/audit";
import { MembershipError, toMembershipError } from "./errors";
import {
  endOverdueMemberships,
  getGymClock,
  lockMembership,
  lockUsers,
  requireActiveAdmin,
  requireActiveUser,
  resolveOpenBase,
  type OpenBaseResolution,
  type Tx,
} from "./internal";
import { computePeriod, isEnded, isOverdue, type Period } from "./rules";
import {
  ipHashSchema,
  manualPaymentMethodSchema,
  noteSchema,
  referenceSchema,
  userIdSchema,
  type ManualPaymentMethod,
} from "./schemas";

const createInput = z.object({
  actorId: userIdSchema,
  userId: userIdSchema,
  planId: z.uuid(),
  method: manualPaymentMethodSchema,
  reference: referenceSchema,
  note: noteSchema,
  confirmSwitch: z.boolean().default(false),
  ipHash: ipHashSchema,
});

const extendInput = z.object({
  actorId: userIdSchema,
  membershipId: z.uuid(),
  method: manualPaymentMethodSchema,
  reference: referenceSchema,
  note: noteSchema,
  ipHash: ipHashSchema,
});

export type CreateManualMembershipInput = z.input<typeof createInput>;
export type ExtendManualMembershipInput = z.input<typeof extendInput>;

export type ManualMembershipResult = {
  membershipId: string;
  paymentId: string;
  periodStart: Date;
  periodEnd: Date;
  replaced: OpenBaseResolution;
};

export type ManualExtensionResult = {
  membershipId: string;
  paymentId: string;
  previousEnd: Date;
  newEnd: Date;
};

type PaymentFields = {
  method: ManualPaymentMethod;
  reference: string | null;
  note: string | null;
};

/** Pre-check for the `payments_method_reference_key` backstop index. */
async function assertReferenceUnused(tx: Tx, { method, reference }: PaymentFields): Promise<void> {
  if (reference === null) return;
  const existing = await tx.payment.findFirst({
    where: { method, reference, status: { not: "VOIDED" } },
    select: { id: true },
  });
  if (existing) throw new MembershipError("DUPLICATE_REFERENCE");
}

type RecordPaymentInput = PaymentFields & {
  membershipId: string;
  userId: string;
  plan: Pick<Plan, "priceCents" | "currency">;
  period: Period;
  actorId: string;
  ipHash: string | null;
  now: Date;
};

/** Inserts a SUCCEEDED manual payment for the period at the plan's price, and audits it. */
async function recordPayment(tx: Tx, input: RecordPaymentInput): Promise<string> {
  const { membershipId, userId, plan, period, actorId, ipHash, now } = input;
  const payment = await tx.payment.create({
    data: {
      membershipId,
      userId,
      method: input.method,
      status: "SUCCEEDED",
      amountCents: plan.priceCents,
      currency: plan.currency,
      periodStart: period.start,
      periodEnd: period.end,
      paidAt: now,
      reference: input.reference,
      note: input.note,
      recordedById: actorId,
      createdAt: now,
    },
    select: { id: true },
  });
  await audit(tx, {
    actorId,
    action: "payment.recorded",
    targetType: "payment",
    targetId: payment.id,
    details: { membershipId, method: input.method, amountCents: plan.priceCents, currency: plan.currency },
    ipHash,
    createdAt: now,
  });
  return payment.id;
}

/**
 * Records a manual payment for an active, non-trial plan and creates the membership it pays for
 * (MANUAL, ACTIVE, period from now), with the member's OWNER seat and, for credit plans, the
 * credit grant. An open base seat is superseded, switched (`confirmSwitch`), or rejected as in
 * `resolveOpenBase`. The amount always comes from the plan.
 */
export async function createManualMembership(input: CreateManualMembershipInput): Promise<ManualMembershipResult> {
  const { actorId, userId, planId, confirmSwitch, ipHash, ...fields } = createInput.parse(input);
  const now = new Date();

  try {
    return await db.$transaction(async (tx) => {
      const users = await lockUsers(tx, [actorId, userId]);
      requireActiveAdmin(users, actorId);
      requireActiveUser(users, userId);

      const plan = await tx.plan.findUnique({ where: { id: planId } });
      if (!plan || !plan.active || plan.trialKind !== null) throw new MembershipError("PLAN_UNAVAILABLE");
      await assertReferenceUnused(tx, fields);

      await endOverdueMemberships(tx, userId, now, "manual_create");

      const clock = await getGymClock(tx);
      const period = computePeriod(plan, now, clock);
      if (!period) throw new MembershipError("CLOSED_FOR_TODAY");

      const replaced = await resolveOpenBase(tx, {
        memberId: userId,
        plan,
        confirmSwitch,
        now,
        timeZone: clock.timeZone,
        actorId,
        ipHash,
      });

      const membership = await tx.membership.create({
        data: {
          ownerId: userId,
          planId: plan.id,
          source: "MANUAL",
          status: "ACTIVE",
          createdById: actorId,
          startsAt: period.start,
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
          createdAt: now,
        },
        select: { id: true },
      });
      await tx.membershipMember.create({
        data: { membershipId: membership.id, userId, role: "OWNER", planType: plan.type, joinedAt: now },
      });
      if (plan.classAccess === "CREDITS" && plan.credits !== null) {
        await tx.creditLedger.create({
          data: { membershipId: membership.id, userId, delta: plan.credits, reason: "GRANT", actorId, createdAt: now },
        });
      }

      await audit(tx, {
        actorId,
        action: "membership.created",
        targetType: "membership",
        targetId: membership.id,
        details: {
          via: "manual",
          planId: plan.id,
          ...(replaced.action === "none" ? {} : { replacedMembershipId: replaced.membershipId, replaced: replaced.action }),
        },
        ipHash,
        createdAt: now,
      });
      const paymentId = await recordPayment(tx, {
        ...fields,
        membershipId: membership.id,
        userId,
        plan,
        period,
        actorId,
        ipHash,
        now,
      });

      return { membershipId: membership.id, paymentId, periodStart: period.start, periodEnd: period.end, replaced };
    });
  } catch (error) {
    throw toMembershipError(error);
  }
}

/**
 * Records a manual payment that extends a running manual membership on a recurring plan by one
 * plan interval, from its current period end. The price comes from the plan, even if the plan
 * is no longer active. A lapsed membership is not extended (`MEMBERSHIP_ENDED`).
 */
export async function extendManualMembership(input: ExtendManualMembershipInput): Promise<ManualExtensionResult> {
  const { actorId, membershipId, ipHash, ...fields } = extendInput.parse(input);
  const now = new Date();

  try {
    return await db.$transaction(async (tx) => {
      const target = await tx.membership.findUnique({ where: { id: membershipId }, select: { ownerId: true } });
      if (!target) throw new MembershipError("MEMBERSHIP_NOT_FOUND");
      const { ownerId } = target;

      const users = await lockUsers(tx, [actorId, ownerId]);
      requireActiveAdmin(users, actorId);
      requireActiveUser(users, ownerId);

      await endOverdueMemberships(tx, ownerId, now, "manual_extend");
      const membership = await lockMembership(tx, membershipId);
      if (isEnded(membership) || isOverdue(membership, now)) throw new MembershipError("MEMBERSHIP_ENDED");
      if (membership.source !== "MANUAL" || membership.plan.billing !== "RECURRING") {
        throw new MembershipError("NOT_EXTENDABLE");
      }
      await assertReferenceUnused(tx, fields);

      const previousEnd = membership.currentPeriodEnd;
      const period = computePeriod(membership.plan, previousEnd, await getGymClock(tx));
      if (!period) throw new Error("A recurring plan always has a next period");

      await tx.membership.update({ where: { id: membership.id }, data: { currentPeriodEnd: period.end } });
      const paymentId = await recordPayment(tx, {
        ...fields,
        membershipId: membership.id,
        userId: ownerId,
        plan: membership.plan,
        period,
        actorId,
        ipHash,
        now,
      });
      await audit(tx, {
        actorId,
        action: "membership.extended",
        targetType: "membership",
        targetId: membership.id,
        details: { paymentId, previousEnd: previousEnd.toISOString(), newEnd: period.end.toISOString() },
        ipHash,
        createdAt: now,
      });

      return { membershipId: membership.id, paymentId, previousEnd, newEnd: period.end };
    });
  } catch (error) {
    throw toMembershipError(error);
  }
}
