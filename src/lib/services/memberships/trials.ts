import "server-only";
import { z } from "zod";
import type { Plan, TrialKind } from "@/generated/prisma/client";
import { keyedHash } from "@/lib/crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/services/audit";
import { MembershipError, toMembershipError, type MembershipErrorCode } from "./errors";
import {
  consumeRateLimit,
  endOverdueMemberships,
  getGymClock,
  lockUsers,
  openBaseSeat,
  paidAccessHistory,
  requireActiveUser,
  type LockedUser,
  type Tx,
} from "./internal";
import { computePeriod, isEnded, isOverdue, type GymClock, type Period } from "./rules";
import { ipHashSchema, userIdSchema } from "./schemas";

export const TRIAL_KINDS = ["GYM", "CLASS"] as const satisfies readonly TrialKind[];

const startInput = z.object({
  userId: userIdSchema,
  kind: z.enum(TRIAL_KINDS),
  /** The raw client IP, used only as a rate-limit identifier (hashed by the limiter). */
  ip: z
    .string()
    .trim()
    .max(255)
    .nullish()
    .transform((value) => (value ? value : null)),
  ipHash: ipHashSchema,
});

export type StartTrialInput = z.input<typeof startInput>;

export type StartTrialResult = {
  membershipId: string;
  kind: TrialKind;
  periodStart: Date;
  periodEnd: Date;
};

/** Why a trial can't start for the person right now; each is also the code `startTrial` fails with. */
export type TrialIneligibleReason = Extract<
  MembershipErrorCode,
  "EMAIL_NOT_VERIFIED" | "TRIAL_UNAVAILABLE" | "TRIAL_ALREADY_USED" | "NOT_ELIGIBLE" | "HAS_ACTIVE_BASE" | "CLOSED_FOR_TODAY"
>;

export type TrialEligibility =
  | { eligible: true; planId: string; planName: string; endsAt: Date }
  | { eligible: false; reason: TrialIneligibleReason };

type TrialCheck = { ok: true; plan: Plan; period: Period } | { ok: false; reason: TrialIneligibleReason };

/** The redemption key for an email: the same address on a new account can't repeat a trial. */
export function trialEmailHash(email: string): string {
  return keyedHash("trial", email.trim().toLowerCase());
}

/**
 * The `trialStartIp` identifier. Requests without a client IP share one bucket, like the auth
 * limits (Better Auth's per-IP limiter and the sign-in limit), so a missing header never lifts it.
 */
export function trialIpIdentifier(ip: string | null): string {
  return ip ?? "no-ip";
}

/**
 * Decision 3 and the start conditions, without writing: verified email, an active trial plan of
 * the kind, no redemption of the kind by the account or its email, no paid history with the
 * kind's access, and for a base trial no open base seat (overdue ones excluded, since cleanup ends
 * them) and a period today.
 */
async function checkTrial(
  tx: Tx,
  user: Pick<LockedUser, "id" | "email" | "emailVerified">,
  kind: TrialKind,
  clock: GymClock,
  now: Date,
): Promise<TrialCheck> {
  const fail = (reason: TrialIneligibleReason): TrialCheck => ({ ok: false, reason });
  if (!user.emailVerified) return fail("EMAIL_NOT_VERIFIED");

  const plan = await tx.plan.findFirst({ where: { trialKind: kind, active: true } });
  if (!plan) return fail("TRIAL_UNAVAILABLE");

  const redeemed = await tx.trialRedemption.findFirst({
    where: { kind, OR: [{ userId: user.id }, { emailHash: trialEmailHash(user.email) }] },
    select: { id: true },
  });
  if (redeemed) return fail("TRIAL_ALREADY_USED");

  const history = await paidAccessHistory(tx, user.id);
  if (kind === "GYM" ? history.openAccess : history.classAccess) return fail("NOT_ELIGIBLE");

  if (plan.type === "BASE") {
    const seat = await openBaseSeat(tx, user.id);
    if (seat && !isEnded(seat.membership) && !isOverdue(seat.membership, now)) return fail("HAS_ACTIVE_BASE");
  }

  const period = computePeriod(plan, now, clock);
  if (!period) return fail("CLOSED_FOR_TODAY");
  return { ok: true, plan, period };
}

/**
 * The person starts a free trial of the kind (decision 2): a TRIAL membership from now (the Gym
 * Trial until today's closing time, the Class Trial for 7 days with its credit), the OWNER seat,
 * and the redemption that blocks the kind for the account and its email. No payment row.
 * Every attempt counts toward `trialStartUser` and `trialStartIp`, checked before the transaction.
 */
export async function startTrial(input: StartTrialInput): Promise<StartTrialResult> {
  const { userId, kind, ip, ipHash } = startInput.parse(input);

  await consumeRateLimit("trialStartUser", userId);
  await consumeRateLimit("trialStartIp", trialIpIdentifier(ip));

  const now = new Date();
  try {
    return await db.$transaction(async (tx) => {
      const user = requireActiveUser(await lockUsers(tx, [userId]), userId);

      await endOverdueMemberships(tx, userId, now, "trial_start");
      const check = await checkTrial(tx, user, kind, await getGymClock(tx), now);
      if (!check.ok) throw new MembershipError(check.reason);
      const { plan, period } = check;

      const membership = await tx.membership.create({
        data: {
          ownerId: userId,
          planId: plan.id,
          source: "TRIAL",
          status: "ACTIVE",
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
      await tx.trialRedemption.create({
        data: { userId, membershipId: membership.id, kind, emailHash: trialEmailHash(user.email), phoneHash: null, createdAt: now },
      });
      if (plan.classAccess === "CREDITS" && plan.credits !== null) {
        await tx.creditLedger.create({
          data: { membershipId: membership.id, userId, delta: plan.credits, reason: "GRANT", actorId: userId, createdAt: now },
        });
      }

      await audit(tx, {
        actorId: userId,
        action: "membership.trial_started",
        targetType: "membership",
        targetId: membership.id,
        details: { kind, planId: plan.id },
        ipHash,
        createdAt: now,
      });

      return { membershipId: membership.id, kind, periodStart: period.start, periodEnd: period.end };
    });
  } catch (error) {
    throw toMembershipError(error);
  }
}

/**
 * Whether each trial kind could start for the person now, and when it would end; read-only, for
 * the membership page. A trial that is offered can still fail at start if something changes.
 */
export async function trialEligibility(userId: string): Promise<Record<TrialKind, TrialEligibility>> {
  const id = userIdSchema.parse(userId);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id },
      select: { id: true, email: true, emailVerified: true, anonymizedAt: true },
    });
    if (!user) throw new MembershipError("USER_NOT_FOUND");
    if (user.anonymizedAt) throw new MembershipError("USER_ANONYMIZED");

    const clock = await getGymClock(tx);
    const evaluate = async (kind: TrialKind): Promise<TrialEligibility> => {
      const check = await checkTrial(tx, user, kind, clock, now);
      return check.ok
        ? { eligible: true, planId: check.plan.id, planName: check.plan.name, endsAt: check.period.end }
        : { eligible: false, reason: check.reason };
    };
    return { GYM: await evaluate("GYM"), CLASS: await evaluate("CLASS") };
  });
}
