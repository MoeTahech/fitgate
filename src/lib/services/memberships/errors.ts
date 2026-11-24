import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

export type MembershipErrorCode =
  | "ACTOR_NOT_ADMIN"
  | "USER_NOT_FOUND"
  | "USER_ANONYMIZED"
  | "MEMBERSHIP_NOT_FOUND"
  | "PLAN_UNAVAILABLE"
  | "CLOSED_FOR_TODAY"
  | "MEMBERSHIP_ENDED"
  | "NOT_EXTENDABLE"
  | "HAS_ACTIVE_BASE"
  | "SAME_PLAN"
  | "DUPLICATE_REFERENCE"
  | "TRIAL_ALREADY_USED";

export type MembershipErrorDetails = Readonly<Record<string, string | number | boolean | null>>;

/**
 * Why an open base seat blocks a new BASE membership (`HAS_ACTIVE_BASE` details):
 * - `SWITCH_NEEDS_CONFIRMATION`: a manual recurring membership the member owns; it can be
 *   switched with confirmation, losing `remainingDays` (and the partner when `hasPartner`).
 * - `SWITCH_TARGET_NOT_RECURRING`: a manual recurring membership the member owns, which can only
 *   be switched to another recurring plan (no confirmation override).
 * - `DAY_PASS_OR_TRIAL`: an open Day Pass or trial, which only a recurring plan supersedes.
 * - `STRIPE_BASE`: a Stripe membership, which only Stripe ends.
 * - `ONE_TIME_BASE`: another manual one-time base plan, which runs until its end.
 * - `PARTNER_SEAT`: the member is the partner on someone else's membership.
 */
export type OpenBaseConflictDetails =
  | { reason: "SWITCH_NEEDS_CONFIRMATION"; remainingDays: number; hasPartner: boolean }
  | { reason: "SWITCH_TARGET_NOT_RECURRING" | "DAY_PASS_OR_TRIAL" | "STRIPE_BASE" | "ONE_TIME_BASE" | "PARTNER_SEAT" };

export type OpenBaseConflictReason = OpenBaseConflictDetails["reason"];

export class MembershipError extends Error {
  readonly code: MembershipErrorCode;
  readonly details: MembershipErrorDetails | undefined;

  constructor(code: MembershipErrorCode, details?: MembershipErrorDetails) {
    super(code);
    this.name = "MembershipError";
    this.code = code;
    this.details = details;
  }
}

const UNIQUE_INDEX_CODES: Readonly<Record<string, MembershipErrorCode>> = {
  membership_members_one_active_base_key: "HAS_ACTIVE_BASE",
  payments_method_reference_key: "DUPLICATE_REFERENCE",
  trial_redemptions_user_id_kind_key: "TRIAL_ALREADY_USED",
  trial_redemptions_email_hash_kind_key: "TRIAL_ALREADY_USED",
  trial_redemptions_phone_hash_kind_key: "TRIAL_ALREADY_USED",
};

const uniqueViolationSchema = z.object({
  cause: z.object({
    kind: z.literal("UniqueConstraintViolation"),
    constraint: z.object({ index: z.string() }),
  }),
});

/** The unique index a Prisma error violated (P2002 from model calls, P2010 from raw queries), if any. */
export function violatedUniqueIndex(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const parsed = uniqueViolationSchema.safeParse(error.meta?.driverAdapterError);
  return parsed.success ? parsed.data.cause.constraint.index : null;
}

/** Maps a unique violation on a backstop index to its domain error; anything else is rethrown as is. */
export function toMembershipError(error: unknown): unknown {
  const index = violatedUniqueIndex(error);
  const code = index === null ? undefined : UNIQUE_INDEX_CODES[index];
  return code ? new MembershipError(code) : error;
}
