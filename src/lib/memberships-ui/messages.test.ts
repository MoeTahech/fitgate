import { describe, expect, it } from "vitest";
import type {
  FreezeDatesDetails,
  MembershipErrorCode,
  MembershipErrorDetails,
  OpenBaseConflictReason,
} from "@/lib/services/memberships/errors";
import { freezeRequestFormSchema, inviteFormSchema, recordPaymentFormSchema, refundFormSchema } from "./forms";
import {
  AUTH_ERROR_MESSAGES,
  CONFLICT_REASON_MESSAGES,
  FREEZE_DATE_FIELD_ERRORS,
  authErrorResult,
  membershipErrorResult,
  switchLossText,
  type MessageAudience,
} from "./messages";

// A complete Record, so a new error code fails tsc here too.
const ALL_CODES: Record<MembershipErrorCode, true> = {
  ACTOR_NOT_ADMIN: true,
  USER_NOT_FOUND: true,
  USER_ANONYMIZED: true,
  MEMBERSHIP_NOT_FOUND: true,
  PLAN_UNAVAILABLE: true,
  CLOSED_FOR_TODAY: true,
  MEMBERSHIP_ENDED: true,
  NOT_EXTENDABLE: true,
  HAS_ACTIVE_BASE: true,
  SAME_PLAN: true,
  DUPLICATE_REFERENCE: true,
  TRIAL_ALREADY_USED: true,
  TRIAL_UNAVAILABLE: true,
  NOT_ELIGIBLE: true,
  EMAIL_NOT_VERIFIED: true,
  RATE_LIMITED: true,
  PAYMENT_NOT_FOUND: true,
  NOT_MANUAL: true,
  NOT_LATEST_PAYMENT: true,
  HAS_REFUND: true,
  ALREADY_REFUNDED: true,
  INVALID_AMOUNT: true,
  PAYMENT_NOT_VALID: true,
  NOT_OWNER: true,
  NOT_FREEZABLE: true,
  INVALID_FREEZE_DATES: true,
  FREEZE_ALREADY_OPEN: true,
  FREEZE_NOT_FOUND: true,
  FREEZE_NOT_OPEN: true,
  FREEZE_STARTED: true,
  NOT_COUPLES_PLAN: true,
  MEMBERSHIP_NOT_USABLE: true,
  NO_FREE_SEAT: true,
  INVITE_OWN_EMAIL: true,
  INVITE_NOT_FOUND: true,
  INVITE_NOT_PENDING: true,
  INVITE_NOT_LATEST: true,
  INVITE_EXPIRED: true,
  INVITE_REVOKED: true,
  INVITE_ALREADY_ACCEPTED: true,
  EMAIL_MISMATCH: true,
  OWN_MEMBERSHIP: true,
  PARTNER_NOT_FOUND: true,
};
const CODES = Object.keys(ALL_CODES) as MembershipErrorCode[];
const AUDIENCES: MessageAudience[] = ["member", "admin"];

const BLOCKING_REASONS: Record<Exclude<OpenBaseConflictReason, "SWITCH_NEEDS_CONFIRMATION">, true> = {
  SWITCH_TARGET_NOT_RECURRING: true,
  DAY_PASS_OR_TRIAL: true,
  STRIPE_BASE: true,
  ONE_TIME_BASE: true,
  PARTNER_SEAT: true,
};
const FREEZE_REASONS: Record<FreezeDatesDetails["reason"], true> = {
  END_BEFORE_START: true,
  TOO_SOON: true,
  TOO_LONG: true,
  AFTER_PERIOD_END: true,
};

/** The single text a result shows: its message or its one field error. */
function shownText(result: ReturnType<typeof membershipErrorResult>): string {
  const texts = [result.message, ...Object.values(result.fieldErrors ?? {})].filter((text) => text !== undefined);
  expect(texts).toHaveLength(1);
  return texts[0];
}

describe("membershipErrorResult", () => {
  it.each(AUDIENCES)("gives every code finished %s copy", (audience) => {
    for (const code of CODES) {
      const result = membershipErrorResult({ code }, audience);
      expect(result.status).toBe("error");
      const text = shownText(result);
      expect(text.trim().length, code).toBeGreaterThan(10);
      expect(text, code).not.toMatch(/[{}]|undefined|null|[A-Z]{2,}_[A-Z]/);
    }
  });

  it("rate limiting reads the same for everyone and reveals nothing about accounts", () => {
    const member = shownText(membershipErrorResult({ code: "RATE_LIMITED" }, "member"));
    const admin = shownText(membershipErrorResult({ code: "RATE_LIMITED" }, "admin"));
    expect(member).toBe(admin);
    expect(member).toMatch(/too many attempts/i);
    expect(member).not.toMatch(/account|email|exist|user/i);
  });

  it("puts field errors on the field they belong to", () => {
    expect(membershipErrorResult({ code: "INVITE_OWN_EMAIL" }, "member").fieldErrors).toHaveProperty("email");
    expect(membershipErrorResult({ code: "DUPLICATE_REFERENCE" }, "admin").fieldErrors).toHaveProperty("reference");
    expect(membershipErrorResult({ code: "INVALID_AMOUNT" }, "admin").fieldErrors).toHaveProperty("amount");
  });

  it("names only fields the shared form schemas have", () => {
    expect(Object.keys(inviteFormSchema.shape)).toContain("email");
    expect(Object.keys(recordPaymentFormSchema.shape)).toContain("reference");
    const refund = refundFormSchema("usd").safeParse({ paymentId: "x", amount: "x", reason: "" });
    expect(refund.success).toBe(false);
    expect(refund.error?.issues.map((issue) => issue.path[0])).toContain("amount");
    const freezeFields = Object.keys(freezeRequestFormSchema.shape);
    for (const { field } of Object.values(FREEZE_DATE_FIELD_ERRORS)) expect(freezeFields).toContain(field);
  });

  describe("HAS_ACTIVE_BASE", () => {
    it.each(Object.keys(BLOCKING_REASONS) as (keyof typeof BLOCKING_REASONS)[])("explains %s to an admin", (reason) => {
      const result = membershipErrorResult({ code: "HAS_ACTIVE_BASE", details: { reason } }, "admin");
      expect(result.message).toBe(CONFLICT_REASON_MESSAGES[reason]);
    });

    it("gives a stale switch the day count and asks for confirmation", () => {
      const details = { reason: "SWITCH_NEEDS_CONFIRMATION", remainingDays: 12, hasPartner: false };
      const message = membershipErrorResult({ code: "HAS_ACTIVE_BASE", details }, "admin").message;
      expect(message).toContain("12 days left will be lost");
      expect(message).toMatch(/confirm the switch/i);
      expect(message).not.toMatch(/partner/i);
    });

    it("mentions the partner and uses the singular for one day", () => {
      const details = { reason: "SWITCH_NEEDS_CONFIRMATION", remainingDays: 1, hasPartner: true };
      const message = membershipErrorResult({ code: "HAS_ACTIVE_BASE", details }, "admin").message;
      expect(message).toContain("1 day left will be lost");
      expect(message).toContain("The partner will be removed.");
    });

    it("falls back to the generic copy when the details don't parse", () => {
      const generic = membershipErrorResult({ code: "HAS_ACTIVE_BASE" }, "admin").message;
      const malformed: MembershipErrorDetails[] = [
        { reason: "SOMETHING_ELSE" },
        { reason: "SWITCH_NEEDS_CONFIRMATION", remainingDays: "3", hasPartner: false },
        { reason: "SWITCH_NEEDS_CONFIRMATION", remainingDays: -1, hasPartner: false },
      ];
      for (const details of malformed) {
        expect(membershipErrorResult({ code: "HAS_ACTIVE_BASE", details }, "admin").message).toBe(generic);
      }
    });

    it("gives members one generic line whatever the reason", () => {
      const generic = membershipErrorResult({ code: "HAS_ACTIVE_BASE" }, "member").message;
      expect(membershipErrorResult({ code: "HAS_ACTIVE_BASE", details: { reason: "PARTNER_SEAT" } }, "member").message).toBe(generic);
    });
  });

  describe("INVALID_FREEZE_DATES", () => {
    it.each(Object.keys(FREEZE_REASONS) as FreezeDatesDetails["reason"][])("maps %s to its date field for members", (reason) => {
      const result = membershipErrorResult({ code: "INVALID_FREEZE_DATES", details: { reason } }, "member");
      const { field, message } = FREEZE_DATE_FIELD_ERRORS[reason];
      expect(result).toEqual({ status: "error", fieldErrors: { [field]: message } });
    });

    it("puts TOO_SOON on the first day and TOO_LONG on the last day", () => {
      expect(FREEZE_DATE_FIELD_ERRORS.TOO_SOON.field).toBe("firstDay");
      expect(FREEZE_DATE_FIELD_ERRORS.TOO_LONG.field).toBe("lastDay");
      expect(FREEZE_DATE_FIELD_ERRORS.TOO_LONG.message).toContain("30 days");
    });

    it("falls back to a form message when the reason is missing", () => {
      const result = membershipErrorResult({ code: "INVALID_FREEZE_DATES", details: { reason: "LATER" } }, "member");
      expect(result.fieldErrors).toBeUndefined();
      expect(result.message).toBeTruthy();
    });
  });
});

describe("switchLossText", () => {
  it("states what is lost", () => {
    expect(switchLossText({ fromName: "Basic", remainingDays: 0, hasPartner: false })).toBe(
      "Basic ends now and 0 days left will be lost; paid time isn't refunded.",
    );
  });
});

describe("authErrorResult", () => {
  it("has copy for both auth error codes", () => {
    expect(authErrorResult("UNAUTHENTICATED")).toEqual({ status: "error", message: AUTH_ERROR_MESSAGES.UNAUTHENTICATED });
    expect(authErrorResult("FORBIDDEN").message).toMatch(/permission/i);
  });
});
