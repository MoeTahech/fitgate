import type { Membership, MembershipFreeze, MembershipStatus, OpeningHours, Plan } from "@/generated/prisma/client";
import { addDaysZoned, addMonthsZoned, startOfZonedDay, zonedParts, zonedToInstant, type LocalDate } from "@/lib/time";

const DAY_MS = 86_400_000;
export const PAST_DUE_GRACE_MS = 3 * DAY_MS;

export type MembershipState = Pick<
  Membership,
  "status" | "source" | "currentPeriodStart" | "currentPeriodEnd" | "pastDueSince" | "cancelAtPeriodEnd"
> & { plan: Pick<Plan, "billing"> };

export type FreezeWindow = Pick<MembershipFreeze, "status" | "startsAt" | "endsAt">;

export type PeriodPlan = Pick<Plan, "billing" | "intervalMonths" | "durationDays" | "durationMode">;

export type GymClock = {
  timeZone: string;
  openingHours: readonly Pick<OpeningHours, "weekday" | "opensAtMin" | "closesAtMin">[];
};

export type Period = { start: Date; end: Date };

type Interval = { from: number; to: number };

/** CANCELLED and EXPIRED are terminal; the stored status says so. */
export function isEnded(m: Pick<Membership, "status">): boolean {
  return m.status === "CANCELLED" || m.status === "EXPIRED";
}

/** Only Stripe subscriptions on recurring plans renew, until they are set to cancel at period end. */
export function isAutoRenewing(m: Pick<MembershipState, "source" | "cancelAtPeriodEnd" | "plan">): boolean {
  return m.source === "STRIPE" && m.plan.billing === "RECURRING" && !m.cancelAtPeriodEnd;
}

/** Not marked ended yet, but its period is over and nothing will renew it. */
export function isOverdue(m: MembershipState, now: Date): boolean {
  return !isEnded(m) && !isAutoRenewing(m) && m.currentPeriodEnd.getTime() <= now.getTime();
}

/** The status overdue cleanup writes when it ends an overdue membership. */
export function overdueEndStatus(m: Pick<Membership, "cancelAtPeriodEnd">): Extract<MembershipStatus, "CANCELLED" | "EXPIRED"> {
  return m.cancelAtPeriodEnd ? "CANCELLED" : "EXPIRED";
}

/** APPROVED freezes block access; COMPLETED ones are approved freezes whose window has been settled. */
function isFreezeInEffect(f: FreezeWindow): boolean {
  return f.status === "APPROVED" || f.status === "COMPLETED";
}

function freezeCovers(freezes: readonly FreezeWindow[], t: number): boolean {
  return freezes.some((f) => isFreezeInEffect(f) && f.startsAt.getTime() <= t && t < f.endsAt.getTime());
}

/** The stored window in which the membership grants access, before freezes are taken out. */
function statusWindow(m: MembershipState): Interval | null {
  switch (m.status) {
    case "ACTIVE":
      return { from: m.currentPeriodStart.getTime(), to: m.currentPeriodEnd.getTime() };
    case "PAST_DUE":
      return m.pastDueSince ? { from: -Infinity, to: m.pastDueSince.getTime() + PAST_DUE_GRACE_MS } : null;
    default:
      return null;
  }
}

/**
 * Whether the membership grants access at `t`: ACTIVE within its period, or PAST_DUE within
 * the grace period, and in both cases outside every approved freeze window.
 */
export function isUsableAt(m: MembershipState, freezes: readonly FreezeWindow[], t: Date): boolean {
  const window = statusWindow(m);
  const ms = t.getTime();
  return window !== null && window.from <= ms && ms < window.to && !freezeCovers(freezes, ms);
}

/** The status to display: overdue memberships show as ended, and frozen ones inside their freeze window. */
export function effectiveStatus(m: MembershipState, freezes: readonly FreezeWindow[], now: Date): MembershipStatus {
  if (isEnded(m)) return m.status;
  if (isOverdue(m, now)) return overdueEndStatus(m);
  if (freezeCovers(freezes, now.getTime())) return "FROZEN";
  return m.status;
}

/**
 * Whether the membership allows booking a class starting at `classStart`: usable now, and
 * also at class start unless it auto-renews. An auto-renewing membership still can't book
 * into a freeze window.
 */
export function canBookAt(m: MembershipState, freezes: readonly FreezeWindow[], now: Date, classStart: Date): boolean {
  if (!isUsableAt(m, freezes, now)) return false;
  if (isAutoRenewing(m)) return !freezeCovers(freezes, classStart.getTime());
  return isUsableAt(m, freezes, classStart);
}

/** Usable time from `now` on: the access window after `now`, minus the approved freeze windows in it. */
export function remainingUsableMs(m: MembershipState, freezes: readonly FreezeWindow[], now: Date): number {
  if (isOverdue(m, now)) return 0;
  const window = statusWindow(m);
  if (!window) return 0;
  const from = Math.max(window.from, now.getTime());
  const to = window.to;
  if (from >= to) return 0;

  const frozen = freezes
    .filter(isFreezeInEffect)
    .map((f) => ({ from: Math.max(f.startsAt.getTime(), from), to: Math.min(f.endsAt.getTime(), to) }))
    .filter((f) => f.from < f.to)
    .sort((a, b) => a.from - b.from);

  let frozenMs = 0;
  let coveredTo = from;
  for (const f of frozen) {
    const start = Math.max(f.from, coveredTo);
    if (f.to > start) {
      frozenMs += f.to - start;
      coveredTo = f.to;
    }
  }
  return to - from - frozenMs;
}

/** The instant the gym closes on a local day, or null when it has no opening hours that day. */
export function closingTimeOn(day: LocalDate, clock: GymClock): Date | null {
  const { weekday } = zonedParts(startOfZonedDay(day, clock.timeZone), clock.timeZone);
  const hours = clock.openingHours.find((h) => h.weekday === weekday);
  if (!hours) return null;
  return zonedToInstant({ year: day.year, month: day.month, day: day.day, minute: hours.closesAtMin }, clock.timeZone);
}

function requirePositiveInteger(name: string, value: number | null): number {
  if (value === null || !Number.isInteger(value) || value < 1) {
    throw new RangeError(`Plan ${name} must be a positive integer, got ${value}`);
  }
  return value;
}

/**
 * The period of a membership starting at `start`, in the gym's time zone:
 * - recurring plans end `intervalMonths` calendar months later at the same local time
 *   (day clamped to the end of the month);
 * - one-time ROLLING plans end `durationDays` calendar days later at the same local time;
 * - one-time CALENDAR_DAYS plans end at the closing time of the start day.
 * Returns null when a CALENDAR_DAYS plan can't start: no opening hours on the start day,
 * or its closing time has passed.
 */
export function computePeriod(plan: PeriodPlan, start: Date, clock: GymClock): Period | null {
  if (plan.billing === "RECURRING") {
    const months = requirePositiveInteger("intervalMonths", plan.intervalMonths);
    return { start, end: addMonthsZoned(start, months, clock.timeZone) };
  }

  const days = requirePositiveInteger("durationDays", plan.durationDays);
  switch (plan.durationMode) {
    case "ROLLING":
      return { start, end: addDaysZoned(start, days, clock.timeZone) };
    case "CALENDAR_DAYS": {
      if (days !== 1) throw new RangeError(`CALENDAR_DAYS plans last 1 day, got ${days}`);
      const end = closingTimeOn(zonedParts(start, clock.timeZone), clock);
      return end && end.getTime() > start.getTime() ? { start, end } : null;
    }
    default:
      throw new RangeError("One-time plan has no duration mode");
  }
}
