import { z } from "zod";
import { TrialKind } from "@/generated/prisma/enums";
import { emailSchema, fieldErrors } from "@/lib/auth/schemas";
import { centsToAmountInput, formatMoney, parseAmountToCents } from "@/lib/money";
import {
  localDateSchema,
  MANUAL_PAYMENT_METHODS,
  MAX_FREEZE_DAYS,
  noteSchema,
  reasonSchema,
  referenceSchema,
  userIdSchema,
} from "@/lib/services/memberships/schemas";
import type { LocalDate } from "@/lib/time";

export type { ActionOutcome as ActionResult } from "@/components/action-results";

export type ParsedForm<T> = { success: true; data: T } | { success: false; fieldErrors: Record<string, string> };

/**
 * Parses submitted form fields with a shared schema, on the client before submitting and in the
 * server action. Unknown fields (including React's `$ACTION_` keys) are dropped.
 */
export function parseForm<S extends z.ZodType>(schema: S, formData: FormData): ParsedForm<z.output<S>> {
  const result = schema.safeParse(Object.fromEntries(formData));
  return result.success ? { success: true, data: result.data } : { success: false, fieldErrors: fieldErrors(result.error) };
}

const RELOAD_MESSAGE = "This item is no longer available. Reload the page.";

const idField = z.uuid(RELOAD_MESSAGE);

const dateField = z
  .string("Enter a date")
  .trim()
  .min(1, "Enter a date")
  .pipe(z.iso.date("Enter a valid date"))
  .pipe(localDateSchema);

const methodField = z.enum(MANUAL_PAYMENT_METHODS, "Choose a payment method");

/** A checkbox or submitter value: "true" when present. */
const flagField = z
  .literal("true")
  .optional()
  .transform((value) => value === "true");

// ─── Member forms ────────────────────────────────────────────────────────────

export const startTrialFormSchema = z.object({ kind: z.enum(TrialKind, RELOAD_MESSAGE) });

/** Whole local days from `from` to `to` (0 on the same day, negative when `to` is earlier). */
export function localDaysBetween(from: LocalDate, to: LocalDate): number {
  return (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000;
}

/**
 * The freeze request: whole local days `firstDay` to `lastDay`, inclusive, 1 to 30 days. The
 * earliest start depends on the gym's clock; the form sets it as `min`, and the service checks it.
 */
export const freezeRequestFormSchema = z
  .object({ membershipId: idField, firstDay: dateField, lastDay: dateField })
  .superRefine(({ firstDay, lastDay }, ctx) => {
    const span = localDaysBetween(firstDay, lastDay);
    if (span < 0) {
      ctx.addIssue({ code: "custom", path: ["lastDay"], message: "The last day can't be before the first day" });
    } else if (span + 1 > MAX_FREEZE_DAYS) {
      ctx.addIssue({ code: "custom", path: ["lastDay"], message: `A freeze lasts at most ${MAX_FREEZE_DAYS} days` });
    }
  });

export const inviteFormSchema = z.object({ membershipId: idField, email: emailSchema });

export const freezeIdFormSchema = z.object({ freezeId: idField });
export const inviteIdFormSchema = z.object({ inviteId: idField });
export const seatIdFormSchema = z.object({ seatId: idField });
export const membershipIdFormSchema = z.object({ membershipId: idField });

// ─── Admin forms ─────────────────────────────────────────────────────────────

/**
 * Records a payment for a plan. `confirmSwitch` is sent only by the switch dialog's confirm,
 * never pre-set in the form.
 */
export const recordPaymentFormSchema = z.object({
  userId: userIdSchema,
  planId: z.uuid("Choose a plan"),
  method: methodField,
  reference: referenceSchema,
  note: noteSchema,
  confirmSwitch: flagField,
});

export const extendFormSchema = z.object({
  membershipId: idField,
  method: methodField,
  reference: referenceSchema,
  note: noteSchema,
});

export const voidFormSchema = z.object({ paymentId: idField, reason: reasonSchema });

/** The most a refund may be: the full amount (latest payment only), or less than it. */
export type RefundLimit = { amountCents: number; fullAllowed: boolean };

/**
 * The refund dialog: the amount in currency units ("12.50") becomes `amountCents`. With `limit`
 * (the client knows the payment) the amount is also checked against it; the service always is.
 */
export function refundFormSchema(currency: string, limit?: RefundLimit) {
  const example = centsToAmountInput(1250, currency);
  const amountCents = z
    .string("Enter an amount")
    .trim()
    .min(1, "Enter an amount")
    .transform((value, ctx) => {
      const cents = parseAmountToCents(value, currency);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: `Enter an amount like ${example}` });
        return z.NEVER;
      }
      return cents;
    })
    .refine((cents) => cents > 0, "Enter an amount greater than 0")
    .superRefine((cents, ctx) => {
      if (!limit) return;
      if (limit.fullAllowed && cents > limit.amountCents) {
        ctx.addIssue({ code: "custom", message: `Enter at most ${formatMoney(limit.amountCents, currency)}` });
      } else if (!limit.fullAllowed && cents >= limit.amountCents) {
        ctx.addIssue({ code: "custom", message: `Enter less than ${formatMoney(limit.amountCents, currency)}` });
      }
    });

  return z
    .object({ paymentId: idField, amount: amountCents, reason: reasonSchema })
    .transform(({ amount, ...rest }) => ({ ...rest, amountCents: amount }));
}

export const rejectFreezeFormSchema = z.object({ freezeId: idField, reason: noteSchema });
