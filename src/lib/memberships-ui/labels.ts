import type { CreditReason, MemberRole, MembershipSource, PaymentMethod, TrialKind } from "@/generated/prisma/client";

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  CASH: "Cash",
  WHISH: "Whish",
  OMT: "OMT",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
  STRIPE: "Card (Stripe)",
};

export const MEMBERSHIP_SOURCE_LABELS: Readonly<Record<MembershipSource, string>> = {
  MANUAL: "Front desk",
  TRIAL: "Trial",
  STRIPE: "Online (Stripe)",
};

export const MEMBER_ROLE_LABELS: Readonly<Record<MemberRole, string>> = {
  OWNER: "Owner",
  PARTNER: "Partner",
};

export const TRIAL_KIND_LABELS: Readonly<Record<TrialKind, string>> = {
  GYM: "Gym Trial",
  CLASS: "Class Trial",
};

export const CREDIT_REASON_LABELS: Readonly<Record<CreditReason, string>> = {
  GRANT: "Granted",
  BOOKING_DEBIT: "Class booked",
  CANCELLATION_REFUND: "Booking cancelled",
  WAITLIST_REFUND: "Waitlist refund",
  ADMIN_ADJUSTMENT: "Adjusted by staff",
  EXPIRY: "Expired",
};
