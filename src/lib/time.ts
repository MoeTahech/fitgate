export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type LocalDate = {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
};

export type LocalTime = {
  hour?: number;
  minute?: number;
  second?: number;
  millisecond?: number;
};

export type LocalDateTime = LocalDate & LocalTime;

export type ZonedParts = LocalDate & Required<LocalTime> & { weekday: IsoWeekday };

const MS_PER_DAY = 86_400_000;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
const displayFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      era: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function displayFormatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let formatter = displayFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", { ...options, timeZone });
    displayFormatters.set(key, formatter);
  }
  return formatter;
}

function assertInstant(instant: Date): number {
  const ms = instant.getTime();
  if (!Number.isFinite(ms)) {
    throw new RangeError("Invalid date");
  }
  return ms;
}

function assertInteger(name: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${name} must be an integer, got ${value}`);
  }
}

/** Wall-clock fields read as if they were UTC. Out-of-range fields roll over (like `Date.UTC`). */
function wallClockMs(fields: LocalDateTime): number {
  const { year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 } = fields;
  for (const [name, value] of Object.entries({ year, month, day, hour, minute, second, millisecond })) {
    assertInteger(name, value);
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) {
    throw new RangeError("Date out of range");
  }
  return ms;
}

function isoWeekdayOf(year: number, month: number, day: number): IsoWeekday {
  const weekday = new Date(wallClockMs({ year, month, day })).getUTCDay();
  return (weekday === 0 ? 7 : weekday) as IsoWeekday;
}

/** The local calendar date, time, and ISO weekday (Monday = 1) of an instant in a time zone. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const ms = assertInstant(instant);
  const fields: Record<string, string> = {};
  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    fields[part.type] = part.value;
  }
  const yearOfEra = Number(fields.year);
  const year = fields.era === "BC" ? 1 - yearOfEra : yearOfEra;
  const month = Number(fields.month);
  const day = Number(fields.day);
  return {
    year,
    month,
    day,
    hour: Number(fields.hour),
    minute: Number(fields.minute),
    second: Number(fields.second),
    millisecond: ((ms % 1000) + 1000) % 1000,
    weekday: isoWeekdayOf(year, month, day),
  };
}

function offsetMs(utcMs: number, timeZone: string): number {
  return wallClockMs(zonedParts(new Date(utcMs), timeZone)) - utcMs;
}

/**
 * The instant at which the zone's clocks show the given local date and time.
 * Out-of-range fields roll over (`minute: 1440` is midnight of the next day).
 * A time skipped by a DST gap resolves forward by the gap's length; a time that
 * occurs twice in a DST overlap resolves to the earlier instant.
 */
export function zonedToInstant(fields: LocalDateTime, timeZone: string): Date {
  const wall = wallClockMs(fields);
  const offsetBefore = offsetMs(wall - MS_PER_DAY, timeZone);
  const offsetAfter = offsetMs(wall + MS_PER_DAY, timeZone);

  const matches = [wall - offsetBefore, wall - offsetAfter].filter(
    (candidate) => candidate + offsetMs(candidate, timeZone) === wall,
  );
  if (matches.length > 0) {
    return new Date(Math.min(...matches));
  }
  return new Date(wall - offsetBefore);
}

function daysInMonth(year: number, month: number): number {
  return new Date(wallClockMs({ year, month: month + 1, day: 0 })).getUTCDate();
}

function timeOf(parts: ZonedParts): Required<LocalTime> {
  return { hour: parts.hour, minute: parts.minute, second: parts.second, millisecond: parts.millisecond };
}

/** The same local time `days` calendar days later (or earlier when negative). */
export function addDaysZoned(instant: Date, days: number, timeZone: string): Date {
  assertInteger("days", days);
  const parts = zonedParts(instant, timeZone);
  return zonedToInstant({ year: parts.year, month: parts.month, day: parts.day + days, ...timeOf(parts) }, timeZone);
}

/**
 * The same local time `months` calendar months later (or earlier when negative).
 * The day is clamped to the end of the target month (31 Jan + 1 month = 28/29 Feb).
 */
export function addMonthsZoned(instant: Date, months: number, timeZone: string): Date {
  assertInteger("months", months);
  const parts = zonedParts(instant, timeZone);
  const monthIndex = parts.year * 12 + (parts.month - 1) + months;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12 + 1;
  const day = Math.min(parts.day, daysInMonth(year, month));
  return zonedToInstant({ year, month, day, ...timeOf(parts) }, timeZone);
}

/** The first instant of a local calendar day. If midnight falls in a DST gap, that is the end of the gap. */
export function startOfZonedDay(date: LocalDate, timeZone: string): Date {
  return zonedToInstant({ year: date.year, month: date.month, day: date.day }, timeZone);
}

/** A local calendar date as YYYY-MM-DD (date inputs, `localDateSchema`). Only the date fields are used. */
export function isoDate(date: LocalDate): string {
  const pad = (value: number, length: number) => String(value).padStart(length, "0");
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/** Local wall-clock minutes since midnight (0–1439), as opening hours are stored. */
export function localMinutes(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  return parts.hour * 60 + parts.minute;
}

/**
 * The time between two instants as the zone's wall clock shows it: a DST shift in between adds
 * or removes nothing (10:00 to 10:00 ten days later is always 10 days). Negative when `to` is
 * before `from`.
 */
export function localElapsedMs(from: Date, to: Date, timeZone: string): number {
  return wallClockMs(zonedParts(to, timeZone)) - wallClockMs(zonedParts(from, timeZone));
}

export type LocalFormatStyle =Pick<Intl.DateTimeFormatOptions, "dateStyle" | "timeStyle">;

/** Display formatting (en-GB) in the given time zone. Defaults to a medium date and short time. */
export function formatLocal(
  instant: Date,
  timeZone: string,
  style: LocalFormatStyle = { dateStyle: "medium", timeStyle: "short" },
): string {
  assertInstant(instant);
  return displayFormatter(timeZone, { ...style, hourCycle: "h23" }).format(instant);
}

/** Local 24-hour time as HH:MM. */
export function formatLocalTime(instant: Date, timeZone: string): string {
  assertInstant(instant);
  return displayFormatter(timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
}
