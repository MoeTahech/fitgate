import type {
  FreezeStatus,
  MemberRole,
  Membership,
  MembershipFreeze,
  MembershipSource,
  MembershipStatus,
  OpeningHours,
  Plan,
} from "@/generated/prisma/client";
import {
  addDaysZoned,
  addMonthsZoned,
  localElapsedMs,
  startOfZonedDay,
  zonedParts,
  zonedToInstant,
  type LocalDate,
} from "@/lib/time";
import type { OpenBaseConflictReason } from "./errors";

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

/** The access window after `now` with the approved freeze windows taken out, in time order. */
function remainingUsableIntervals(m: MembershipState, freezes: readonly FreezeWindow[], now: Date): Interval[] {
  if (isOverdue(m, now)) return [];
  const window = statusWindow(m);
  if (!window) return [];
  const from = Math.max(window.from, now.getTime());
  const to = window.to;
  if (from >= to) return [];

  const frozen = freezes
    .filter(isFreezeInEffect)
    .map((f) => ({ from: Math.max(f.startsAt.getTime(), from), to: Math.min(f.endsAt.getTime(), to) }))
    .filter((f) => f.from < f.to)
    .sort((a, b) => a.from - b.from);

  const usable: Interval[] = [];
  let cursor = from;
  for (const f of frozen) {
    if (f.from > cursor) usable.push({ from: cursor, to: f.from });
    cursor = Math.max(cursor, f.to);
  }
  if (cursor < to) usable.push({ from: cursor, to });
  return usable;
}

/** Usable time from `now` on: the access window after `now`, minus the approved freeze windows in it. */
export function remainingUsableMs(m: MembershipState, freezes: readonly FreezeWindow[], now: Date): number {
  return remainingUsableIntervals(m, freezes, now).reduce((sum, i) => sum + (i.to - i.from), 0);
}

/**
 * The usable time from `now` on in local days, rounded up: the days a switch gives up
 * (decision 13). Measured on the gym's wall clock, so a DST change doesn't add or remove a day.
 */
export function remainingUsableDays(m: MembershipState, freezes: readonly FreezeWindow[], now: Date, timeZone: string): number {
  const localMs = remainingUsableIntervals(m, freezes, now).reduce(
    (sum, i) => sum + localElapsedMs(new Date(i.from), new Date(i.to), timeZone),
    0,
  );
  return Math.ceil(localMs / DAY_MS);
}

/**
 * The freeze status to display. The stored status is settled lazily by later writes: a request
 * whose start passed undecided has lapsed (`CANCELLED`), and an approved freeze that is over is
 * `COMPLETED`.
 */
export function freezeDisplayStatus(f: FreezeWindow, now: Date): FreezeStatus {
  if (f.status === "REQUESTED" && f.startsAt.getTime() <= now.getTime()) return "CANCELLED";
  if (f.status === "APPROVED" && f.endsAt.getTime() <= now.getTime()) return "COMPLETED";
  return f.status;
}

/** One-time plans that end at the closing time of their start day (Day Pass, Gym Trial). */
export function isCalendarDayPlan(plan: Pick<Plan, "billing" | "durationMode">): boolean {
  return plan.billing === "ONE_TIME" && plan.durationMode === "CALENDAR_DAYS";
}

/** The member's open base seat and its membership, as decision 13 needs them. */
export type OpenBase = {
  seatRole: MemberRole;
  source: MembershipSource;
  planId: string;
  plan: Pick<Plan, "billing" | "durationMode">;
};

/**
 * What recording `plan` does to the member's open base (decision 13):
 * - `none`: not a base plan, or no open base;
 * - `supersede`: a trial or Day Pass the member owns ends now, for a recurring plan;
 * - `switch`: a manual recurring membership the member owns ends now, only with confirmation;
 * - `same_plan`: use Extend instead;
 * - `conflict`: anything else, with the `HAS_ACTIVE_BASE` reason.
 */
export type OpenBaseReplacement =
  | { action: "none" | "supersede" | "switch" | "same_plan" }
  | { action: "conflict"; reason: Exclude<OpenBaseConflictReason, "SWITCH_NEEDS_CONFIRMATION"> };

export function openBaseReplacement(open: OpenBase | null, plan: Pick<Plan, "id" | "type" | "billing">): OpenBaseReplacement {
  if (plan.type !== "BASE" || open === null) return { action: "none" };
  if (open.seatRole !== "OWNER") return { action: "conflict", reason: "PARTNER_SEAT" };

  if (open.source === "TRIAL" || isCalendarDayPlan(open.plan)) {
    return plan.billing === "RECURRING" ? { action: "supersede" } : { action: "conflict", reason: "DAY_PASS_OR_TRIAL" };
  }

  if (open.source === "MANUAL" && open.plan.billing === "RECURRING") {
    if (open.planId === plan.id) return { action: "same_plan" };
    return plan.billing === "RECURRING" ? { action: "switch" } : { action: "conflict", reason: "SWITCH_TARGET_NOT_RECURRING" };
  }

  return { action: "conflict", reason: open.source === "STRIPE" ? "STRIPE_BASE" : "ONE_TIME_BASE" };
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
