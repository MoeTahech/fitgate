import type { FreezeStatus, MembershipStatus } from "@/generated/prisma/client";
import type { OpenBaseView, RecordablePlan } from "@/lib/services/memberships/queries";
import { freezeDisplayStatus, type FreezeWindow } from "@/lib/services/memberships/rules";
import { addDaysZoned, formatLocal, formatLocalTime, zonedParts } from "@/lib/time";
import { CONFLICT_REASON_MESSAGES, switchLossText } from "./messages";

const DATE_ONLY = { dateStyle: "medium" } as const;
const DAY_MS = 86_400_000;

function localDate(instant: Date, timeZone: string): string {
  return formatLocal(instant, timeZone, DATE_ONLY);
}

function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  const x = zonedParts(a, timeZone);
  const y = zonedParts(b, timeZone);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

function pluralDays(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function isEndedStatus(status: MembershipStatus): boolean {
  return status === "CANCELLED" || status === "EXPIRED";
}

// ─── Periods and freezes ─────────────────────────────────────────────────────

type PeriodView = { currentPeriodStart: Date; currentPeriodEnd: Date; endsAtClosing: boolean };

/**
 * The period as dates ("12 Nov 2026 – 12 Dec 2026"). A pass that ends at closing time shows
 * "Valid today until closing (21:00)" on its day, else its date with the closing time.
 */
export function periodText(m: PeriodView, timeZone: string, now: Date): string {
  if (m.endsAtClosing) {
    const closing = formatLocalTime(m.currentPeriodEnd, timeZone);
    return isSameLocalDay(m.currentPeriodEnd, now, timeZone)
      ? `Valid today until closing (${closing})`
      : `${localDate(m.currentPeriodEnd, timeZone)}, until closing (${closing})`;
  }
  return `${localDate(m.currentPeriodStart, timeZone)} – ${localDate(m.currentPeriodEnd, timeZone)}`;
}

type FreezeDates = Pick<FreezeWindow, "startsAt" | "endsAt">;

/** The freeze's last day: `endsAt` is the start of the day after it. */
export function freezeLastDay(f: FreezeDates, timeZone: string): Date {
  return addDaysZoned(f.endsAt, -1, timeZone);
}

/** Whole local days the freeze covers (a DST shift inside it changes nothing). */
export function freezeDayCount(f: FreezeDates, timeZone: string): number {
  const first = zonedParts(f.startsAt, timeZone);
  const last = zonedParts(freezeLastDay(f, timeZone), timeZone);
  return Math.round((Date.UTC(last.year, last.month - 1, last.day) - Date.UTC(first.year, first.month - 1, first.day)) / DAY_MS) + 1;
}

/** "4 Dec 2026 – 10 Dec 2026 (7 days)", or "4 Dec 2026 (1 day)". */
export function freezeDaysText(f: FreezeDates, timeZone: string): string {
  const days = freezeDayCount(f, timeZone);
  const first = localDate(f.startsAt, timeZone);
  const range = days === 1 ? first : `${first} – ${localDate(freezeLastDay(f, timeZone), timeZone)}`;
  return `${range} (${pluralDays(days)})`;
}

const CANCELLABLE_FREEZE_STATUSES: readonly FreezeStatus[] = ["REQUESTED", "APPROVED"];

/** The owner (or an admin) can cancel a requested or approved freeze until it starts. */
export function canCancelFreeze(f: FreezeWindow, now: Date): boolean {
  return CANCELLABLE_FREEZE_STATUSES.includes(freezeDisplayStatus(f, now)) && f.startsAt.getTime() > now.getTime();
}

// ─── Payment corrections ─────────────────────────────────────────────────────

type CorrectedPayment = { periodStart: Date | null; amountCents: number };
type CorrectedMembership = { status: MembershipStatus; currentPeriodStart: Date };

/**
 * What voiding the payment (or refunding it in full) does to its membership, as the service
 * decides it: nothing once the membership has ended; cancellation when the payment activated it
 * (its period starts at or before the current period start); else the end moves back to the
 * payment's period start, which ends the membership when that is already past.
 */
export function correctionEffect(payment: CorrectedPayment, membership: CorrectedMembership, timeZone: string, now: Date): string {
  if (isEndedStatus(membership.status) || payment.periodStart === null) return "The membership has ended, so it stays as it is.";
  if (payment.periodStart.getTime() <= membership.currentPeriodStart.getTime()) return "This cancels the membership.";
  const date = localDate(payment.periodStart, timeZone);
  return payment.periodStart.getTime() <= now.getTime()
    ? `The membership's end moves back to ${date}, which has passed, so it ends now.`
    : `The membership's end moves back to ${date}.`;
}

/**
 * The refund dialog's description for the amount typed so far: a full refund withdraws the paid
 * period like a void; a partial one (or an amount not parsed yet) changes only the amounts.
 */
export function refundEffectText(
  amountCents: number | null,
  payment: CorrectedPayment,
  membership: CorrectedMembership,
  timeZone: string,
  now: Date,
): string {
  if (amountCents !== null && amountCents === payment.amountCents) {
    return `Refunding the full amount withdraws the paid period. ${correctionEffect(payment, membership, timeZone, now)}`;
  }
  return "A partial refund changes only the amounts; the membership stays as it is.";
}

// ─── Record payment ──────────────────────────────────────────────────────────

export type RecordPaymentNotice = {
  tone: "info" | "warning" | "error";
  text: string;
  /** Recording this plan can't succeed; submit is disabled. */
  blocked: boolean;
  /** Submit opens a confirmation (a switch) that sends `confirmSwitch`. */
  needsConfirm: boolean;
  confirmTitle: string | null;
  confirmText: string | null;
};

type NoticePlan = Pick<RecordablePlan, "name" | "replacement" | "closedForToday">;
type NoticeOpenBase = Pick<OpenBaseView, "planName" | "remainingDays" | "hasPartner">;

function notice(tone: RecordPaymentNotice["tone"], text: string, blocked: boolean): RecordPaymentNotice {
  return { tone, text, blocked, needsConfirm: false, confirmTitle: null, confirmText: null };
}

/** What recording `plan` does to the member's open base (decision 3), or null when nothing needs saying. */
export function recordPaymentNotice(plan: NoticePlan, openBase: NoticeOpenBase | null): RecordPaymentNotice | null {
  if (plan.closedForToday) {
    return notice("warning", `The gym is closed for the rest of today, so a ${plan.name} can't start now.`, true);
  }

  const current = openBase?.planName ?? "current membership";
  const { replacement } = plan;
  switch (replacement.action) {
    case "none":
      return null;
    case "supersede":
      return notice("info", `Their ${current} ends now.`, false);
    case "same_plan":
      return notice("info", `They already have ${plan.name}. Use Extend on that membership to add a period.`, true);
    case "conflict":
      return notice("error", CONFLICT_REASON_MESSAGES[replacement.reason], true);
    case "switch": {
      const text = switchLossText({
        fromName: openBase?.planName ?? "The current membership",
        remainingDays: openBase?.remainingDays ?? 0,
        hasPartner: openBase?.hasPartner ?? false,
      });
      const confirmTitle = openBase ? `Switch ${openBase.planName} to ${plan.name}?` : `Switch to ${plan.name}?`;
      return { tone: "warning", text, blocked: false, needsConfirm: true, confirmTitle, confirmText: text };
    }
  }
}
