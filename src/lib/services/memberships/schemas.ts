import { z } from "zod";

export const FREE_TEXT_MAX_LENGTH = 500;
export const REFERENCE_MAX_LENGTH = 100;

export const MANUAL_PAYMENT_METHODS = ["CASH", "WHISH", "OMT", "BANK_TRANSFER", "OTHER"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_PATTERNS = [
  /\b[a-z][a-z\d+.-]*:\/\//i,
  /\bwww\./i,
  /\b(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+(?:com|net|org|io|co|me|app|dev|info|biz|lb|ly|gl|link|site|online)\b/i,
];

const CONTACT_DATA_MESSAGE = "Don't include email addresses, links, or other personal data";

/** True when the text holds neither an email address nor something that looks like a URL. */
export function hasNoContactData(text: string): boolean {
  return !EMAIL_PATTERN.test(text) && !URL_PATTERNS.some((pattern) => pattern.test(text));
}

const freeText = z
  .string()
  .trim()
  .max(FREE_TEXT_MAX_LENGTH, `Use at most ${FREE_TEXT_MAX_LENGTH} characters`)
  .refine(hasNoContactData, CONTACT_DATA_MESSAGE);

/** A required reason (void, refund, freeze rejection): trimmed, 1 to 500 characters, no personal data. */
export const reasonSchema = freeText.refine((value) => value.length > 0, "Enter a reason");

/** An optional note: trimmed, at most 500 characters, no personal data. Blank becomes null. */
export const noteSchema = freeText
  .nullish()
  .transform((value) => (value ? value : null));

/** An optional transaction reference: trimmed, single line, at most 100 characters. Blank becomes null. */
export const referenceSchema = z
  .string()
  .trim()
  .max(REFERENCE_MAX_LENGTH, `Use at most ${REFERENCE_MAX_LENGTH} characters`)
  .regex(/^[^\p{Cc}]*$/u, "Use a single line")
  .nullish()
  .transform((value) => (value ? value : null));

export const manualPaymentMethodSchema = z.enum(MANUAL_PAYMENT_METHODS);

/** A user id (Better Auth string id). */
export const userIdSchema = z.string().min(1).max(64);

export const ipHashSchema = z
  .string()
  .max(128)
  .nullish()
  .transform((value) => value ?? null);
