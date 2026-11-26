import { z } from "zod";
import type { AuthErrorCode } from "@/lib/auth/guards";
import type {
  FreezeDatesDetails,
  MembershipErrorCode,
  MembershipErrorDetails,
  OpenBaseConflictDetails,
  OpenBaseConflictReason,
} from "@/lib/services/memberships/errors";
import { MAX_FREEZE_DAYS } from "@/lib/services/memberships/schemas";
import type { ActionResult } from "./forms";

export type MessageAudience = "member" | "admin";

/** What actions catch: a `MembershipError` (structurally, so this module stays client-safe). */
export type MembershipErrorLike = { code: MembershipErrorCode; details?: MembershipErrorDetails };

const RELOAD = "Reload the page and try again.";
const RATE_LIMITED = "Too many attempts. Please wait a few minutes and try again.";

const MEMBER_MESSAGES: Readonly<Record<MembershipErrorCode, string>> = {
  ACTOR_NOT_ADMIN: "You don't have permission to do that.",
  USER_NOT_FOUND: "Your account can't do this. Please contact the front desk.",
  USER_ANONYMIZED: "Your account can't do this. Please contact the front desk.",
  MEMBERSHIP_NOT_FOUND: `This membership no longer exists. ${RELOAD}`,
  PLAN_UNAVAILABLE: "This plan is no longer offered.",
  CLOSED_FOR_TODAY: "The gym is closed for the rest of today. Try again on a day it's open, before closing time.",
  MEMBERSHIP_ENDED: "This membership has ended.",
  NOT_EXTENDABLE: "This membership can't be extended. Please contact the front desk.",
  HAS_ACTIVE_BASE: "You already have a gym membership running, so you can't start this now.",
  SAME_PLAN: "You already have this plan.",
  DUPLICATE_REFERENCE: "This payment has already been recorded.",
  TRIAL_ALREADY_USED: "You've already used this trial. Each trial can be used once.",
  TRIAL_UNAVAILABLE: "This trial isn't offered right now.",
  NOT_ELIGIBLE: "Trials are for new members. Visit the front desk to join.",
  EMAIL_NOT_VERIFIED: "Verify your email address first, using the link we emailed you.",
  RATE_LIMITED,
  PAYMENT_NOT_FOUND: "This payment can't be changed here. Please contact the front desk.",
  NOT_MANUAL: "This payment can't be changed here. Please contact the front desk.",
  NOT_LATEST_PAYMENT: "This payment can't be changed here. Please contact the front desk.",
  HAS_REFUND: "This payment can't be changed here. Please contact the front desk.",
  ALREADY_REFUNDED: "This payment can't be changed here. Please contact the front desk.",
  INVALID_AMOUNT: "This payment can't be changed here. Please contact the front desk.",
  PAYMENT_NOT_VALID: "This payment can't be changed here. Please contact the front desk.",
  NOT_OWNER: "Only the person who holds this membership can do this.",
  NOT_FREEZABLE: "This membership can't be frozen.",
  INVALID_FREEZE_DATES: "Check the freeze dates.",
  FREEZE_ALREADY_OPEN: "You already have a freeze requested or planned. Cancel it first to choose other dates.",
  FREEZE_NOT_FOUND: `This freeze no longer exists. ${RELOAD}`,
  FREEZE_NOT_OPEN: `This freeze was already decided or cancelled. ${RELOAD}`,
  FREEZE_STARTED: "This freeze has already started, so it can't be changed.",
  NOT_COUPLES_PLAN: "This plan can't be shared with a partner.",
  MEMBERSHIP_NOT_USABLE: "Your membership isn't active right now, so you can't invite a partner.",
  NO_FREE_SEAT: "Your membership has no free place for a partner.",
  INVITE_OWN_EMAIL: "Enter your partner's email address, not your own.",
  INVITE_NOT_FOUND: `This invite no longer exists. ${RELOAD}`,
  INVITE_NOT_PENDING: `This invite is no longer pending. ${RELOAD}`,
  INVITE_NOT_LATEST: `A newer invite replaced this one. ${RELOAD}`,
  INVITE_EXPIRED: "This invite has expired. Send a new one.",
  INVITE_REVOKED: "This invite was withdrawn.",
  INVITE_ALREADY_ACCEPTED: "This invite has already been accepted.",
  EMAIL_MISMATCH: "This invite was sent to a different email address.",
  OWN_MEMBERSHIP: "This is your own membership.",
  PARTNER_NOT_FOUND: `This partner is no longer on the membership. ${RELOAD}`,
};

const ADMIN_MESSAGES: Readonly<Record<MembershipErrorCode, string>> = {
  ACTOR_NOT_ADMIN: "You don't have permission to do that.",
  USER_NOT_FOUND: `This member no longer exists. ${RELOAD}`,
  USER_ANONYMIZED: "This account was deleted, so nothing can be recorded for it.",
  MEMBERSHIP_NOT_FOUND: `This membership no longer exists. ${RELOAD}`,
  PLAN_UNAVAILABLE: "This plan is no longer offered. Choose another plan.",
  CLOSED_FOR_TODAY: "The gym is closed for the rest of today, so this pass can't start now.",
  MEMBERSHIP_ENDED: "This membership has ended, so it can't be changed.",
  NOT_EXTENDABLE: "Only running front-desk memberships on recurring plans can be extended.",
  HAS_ACTIVE_BASE: "They already have a gym membership running.",
  SAME_PLAN: "They already have this plan. Use Extend on that membership instead.",
  DUPLICATE_REFERENCE: "This reference is already recorded for this payment method.",
  TRIAL_ALREADY_USED: "They've already used this trial.",
  TRIAL_UNAVAILABLE: "This trial isn't offered right now.",
  NOT_ELIGIBLE: "Trials are only for people who haven't had this kind of access before.",
  EMAIL_NOT_VERIFIED: "They haven't verified their email address yet.",
  RATE_LIMITED,
  PAYMENT_NOT_FOUND: `This payment no longer exists. ${RELOAD}`,
  NOT_MANUAL: "Online (Stripe) payments are corrected in Stripe, not here.",
  NOT_LATEST_PAYMENT:
    "Only the membership's latest payment can be voided or fully refunded. Correct the later payment first, or refund part of this one.",
  HAS_REFUND: "This payment has a refund, so it can't be voided.",
  ALREADY_REFUNDED: "This payment has already been refunded.",
  INVALID_AMOUNT: "Enter an amount greater than 0 and no more than the payment amount.",
  PAYMENT_NOT_VALID: "This payment was voided or didn't go through, so it can't be corrected.",
  NOT_OWNER: "Only the membership owner or an admin can do this.",
  NOT_FREEZABLE: "Only active front-desk memberships on recurring plans can be frozen.",
  INVALID_FREEZE_DATES: "The freeze dates aren't valid.",
  FREEZE_ALREADY_OPEN: "This membership already has a freeze requested or planned.",
  FREEZE_NOT_FOUND: `This freeze no longer exists. ${RELOAD}`,
  FREEZE_NOT_OPEN: `This freeze was already decided or cancelled. ${RELOAD}`,
  FREEZE_STARTED: "This freeze has already started, so it can no longer be approved, rejected, or cancelled.",
  NOT_COUPLES_PLAN: "This plan can't be shared with a partner.",
  MEMBERSHIP_NOT_USABLE: "This membership isn't active right now.",
  NO_FREE_SEAT: "This membership has no free place for a partner.",
  INVITE_OWN_EMAIL: "The owner can't invite their own email address.",
  INVITE_NOT_FOUND: `This invite no longer exists. ${RELOAD}`,
  INVITE_NOT_PENDING: `This invite is no longer pending. ${RELOAD}`,
  INVITE_NOT_LATEST: `A newer invite replaced this one. ${RELOAD}`,
  INVITE_EXPIRED: "This invite has expired.",
  INVITE_REVOKED: "This invite was withdrawn.",
  INVITE_ALREADY_ACCEPTED: "This invite has already been accepted.",
  EMAIL_MISMATCH: "This invite was sent to a different email address.",
  OWN_MEMBERSHIP: "The owner can't join their own membership.",
  PARTNER_NOT_FOUND: `This partner is no longer on the membership. ${RELOAD}`,
};

const MESSAGES: Readonly<Record<MessageAudience, Readonly<Record<MembershipErrorCode, string>>>> = {
  member: MEMBER_MESSAGES,
  admin: ADMIN_MESSAGES,
};

/** The form field each code belongs to, per audience; the error shows there instead of the form alert. */
const FIELD_OF_CODE: Readonly<Record<MessageAudience, Partial<Record<MembershipErrorCode, string>>>> = {
  member: { INVITE_OWN_EMAIL: "email" },
  admin: { DUPLICATE_REFERENCE: "reference", INVALID_AMOUNT: "amount" },
};

type BlockingConflictReason = Exclude<OpenBaseConflictReason, "SWITCH_NEEDS_CONFIRMATION">;

/** Why an open base blocks recording a plan (admin copy), shared with the record-payment notice. */
export const CONFLICT_REASON_MESSAGES: Readonly<Record<BlockingConflictReason, string>> = {
  SWITCH_TARGET_NOT_RECURRING:
    "Their recurring membership can only be switched to another recurring plan. Record this plan after it ends.",
  DAY_PASS_OR_TRIAL: "Their Day Pass or trial is still running. Only a recurring plan replaces it; record this plan after it ends.",
  STRIPE_BASE: "They have an online (Stripe) membership, which only Stripe can end. Record this plan after it ends.",
  ONE_TIME_BASE: "Their one-time membership runs until its end date. Record this plan after it ends.",
  PARTNER_SEAT:
    "They're the partner on someone else's membership. They have to leave it, or the owner has to remove them, first.",
};

function pluralDays(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** What a switch gives up, for the confirmation and the stale-page error. */
export function switchLossText({ fromName, remainingDays, hasPartner }: { fromName: string; remainingDays: number; hasPartner: boolean }): string {
  const loss = `${fromName} ends now and ${pluralDays(remainingDays)} left will be lost; paid time isn't refunded.`;
  return hasPartner ? `${loss} The partner will be removed.` : loss;
}

const conflictDetailsSchema = z.discriminatedUnion("reason", [
  z.object({ reason: z.literal("SWITCH_NEEDS_CONFIRMATION"), remainingDays: z.number().int().min(0), hasPartner: z.boolean() }),
  z.object({
    reason: z.enum(["SWITCH_TARGET_NOT_RECURRING", "DAY_PASS_OR_TRIAL", "STRIPE_BASE", "ONE_TIME_BASE", "PARTNER_SEAT"]),
  }),
]) satisfies z.ZodType<OpenBaseConflictDetails>;

function conflictMessage(details: MembershipErrorDetails | undefined): string | null {
  const parsed = conflictDetailsSchema.safeParse(details);
  if (!parsed.success) return null;
  const conflict = parsed.data;
  if (conflict.reason === "SWITCH_NEEDS_CONFIRMATION") {
    const loss = switchLossText({ fromName: "Their current membership", ...conflict });
    return `Recording this plan switches their membership: ${loss} Confirm the switch to continue.`;
  }
  return CONFLICT_REASON_MESSAGES[conflict.reason];
}

const freezeDatesSchema = z.object({
  reason: z.enum(["END_BEFORE_START", "TOO_SOON", "TOO_LONG", "AFTER_PERIOD_END"]),
}) satisfies z.ZodType<FreezeDatesDetails>;

/** Freeze date reasons as field errors on the request form. */
export const FREEZE_DATE_FIELD_ERRORS: Readonly<Record<FreezeDatesDetails["reason"], { field: "firstDay" | "lastDay"; message: string }>> = {
  END_BEFORE_START: { field: "lastDay", message: "The last day can't be before the first day" },
  TOO_SOON: { field: "firstDay", message: "Start the freeze the day after tomorrow or later" },
  TOO_LONG: { field: "lastDay", message: `A freeze lasts at most ${MAX_FREEZE_DAYS} days` },
  AFTER_PERIOD_END: { field: "firstDay", message: "The freeze has to start before your membership ends" },
};

/**
 * The action result for a membership error: copy for the audience, on its form field where it
 * belongs to one. Never mentions whether other accounts exist (`RATE_LIMITED` is generic).
 */
export function membershipErrorResult(error: MembershipErrorLike, audience: MessageAudience): ActionResult {
  if (error.code === "INVALID_FREEZE_DATES" && audience === "member") {
    const parsed = freezeDatesSchema.safeParse(error.details);
    if (parsed.success) {
      const { field, message } = FREEZE_DATE_FIELD_ERRORS[parsed.data.reason];
      return { status: "error", fieldErrors: { [field]: message } };
    }
  }

  const message = (error.code === "HAS_ACTIVE_BASE" && audience === "admin" ? conflictMessage(error.details) : null) ?? MESSAGES[audience][error.code];
  const field = FIELD_OF_CODE[audience][error.code];
  return field ? { status: "error", fieldErrors: { [field]: message } } : { status: "error", message };
}

export const AUTH_ERROR_MESSAGES: Readonly<Record<AuthErrorCode, string>> = {
  UNAUTHENTICATED: "Your session has ended. Sign in again to continue.",
  FORBIDDEN: "You don't have permission to do that.",
};

/** The action result when the actor isn't signed in or lacks the role. */
export function authErrorResult(code: AuthErrorCode): ActionResult {
  return { status: "error", message: AUTH_ERROR_MESSAGES[code] };
}
