import { describe, expect, it } from "vitest";
import type { FreezeStatus, MembershipStatus } from "@/generated/prisma/client";
import {
  PAST_DUE_GRACE_MS,
  canBookAt,
  closingTimeOn,
  computePeriod,
  effectiveStatus,
  isAutoRenewing,
  isEnded,
  isOverdue,
  isUsableAt,
  overdueEndStatus,
  remainingUsableMs,
  type FreezeWindow,
  type GymClock,
  type MembershipState,
  type PeriodPlan,
} from "./rules";

const BEIRUT = "Asia/Beirut";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Asia/Beirut is UTC+2 in winter and UTC+3 in summer. In 2027 its clocks jump from
// 00:00 to 01:00 on Sunday 28 March and fall back from 24:00 to 23:00 on Saturday 30 October.

const at = (iso: string) => new Date(iso);
const shift = (instant: Date, ms: number) => new Date(instant.getTime() + ms);

const START = at("2027-01-01T08:00:00Z");
const END = at("2027-02-01T08:00:00Z");

function membership(overrides: Partial<MembershipState> = {}): MembershipState {
  return {
    status: "ACTIVE",
    source: "MANUAL",
    currentPeriodStart: START,
    currentPeriodEnd: END,
    pastDueSince: null,
    cancelAtPeriodEnd: false,
    plan: { billing: "RECURRING" },
    ...overrides,
  };
}

const stripeSubscription = (overrides: Partial<MembershipState> = {}) =>
  membership({ source: "STRIPE", ...overrides });

function freeze(startsAt: string, endsAt: string, status: FreezeStatus = "APPROVED"): FreezeWindow {
  return { status, startsAt: at(startsAt), endsAt: at(endsAt) };
}

function clock(hours: Partial<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, [number, number]>>): GymClock {
  return {
    timeZone: BEIRUT,
    openingHours: Object.entries(hours).map(([weekday, [opensAtMin, closesAtMin]]) => ({
      weekday: Number(weekday),
      opensAtMin,
      closesAtMin,
    })),
  };
}

const everyDay = (opensAtMin: number, closesAtMin: number) =>
  clock({ 1: [opensAtMin, closesAtMin], 2: [opensAtMin, closesAtMin], 3: [opensAtMin, closesAtMin],
    4: [opensAtMin, closesAtMin], 5: [opensAtMin, closesAtMin], 6: [opensAtMin, closesAtMin], 7: [opensAtMin, closesAtMin] });

const SIX_TO_TEN = everyDay(6 * 60, 22 * 60);

const recurring = (intervalMonths: number): PeriodPlan => ({
  billing: "RECURRING", intervalMonths, durationDays: null, durationMode: null,
});
const rolling = (durationDays: number): PeriodPlan => ({
  billing: "ONE_TIME", intervalMonths: null, durationDays, durationMode: "ROLLING",
});
const calendarDay: PeriodPlan = { billing: "ONE_TIME", intervalMonths: null, durationDays: 1, durationMode: "CALENDAR_DAYS" };

describe("isEnded", () => {
  it.each<[MembershipStatus, boolean]>([
    ["ACTIVE", false], ["PAST_DUE", false], ["FROZEN", false], ["CANCELLED", true], ["EXPIRED", true],
  ])("%s -> %s", (status, ended) => {
    expect(isEnded({ status })).toBe(ended);
  });
});

describe("isAutoRenewing", () => {
  it("is true only for a recurring Stripe subscription not set to cancel", () => {
    expect(isAutoRenewing(stripeSubscription())).toBe(true);
    expect(isAutoRenewing(stripeSubscription({ cancelAtPeriodEnd: true }))).toBe(false);
    expect(isAutoRenewing(stripeSubscription({ plan: { billing: "ONE_TIME" } }))).toBe(false);
  });

  it("is never true for manual or trial memberships", () => {
    expect(isAutoRenewing(membership({ source: "MANUAL" }))).toBe(false);
    expect(isAutoRenewing(membership({ source: "TRIAL", plan: { billing: "ONE_TIME" } }))).toBe(false);
  });
});

describe("isUsableAt", () => {
  it("covers an ACTIVE period from its start (inclusive) to its end (exclusive)", () => {
    const m = membership();
    expect(isUsableAt(m, [], shift(START, -1))).toBe(false);
    expect(isUsableAt(m, [], START)).toBe(true);
    expect(isUsableAt(m, [], shift(END, -1))).toBe(true);
    expect(isUsableAt(m, [], END)).toBe(false);
  });

  it("covers PAST_DUE until 3 days after pastDueSince, even past the period end", () => {
    const pastDueSince = shift(END, -HOUR);
    const m = stripeSubscription({ status: "PAST_DUE", pastDueSince });
    expect(PAST_DUE_GRACE_MS).toBe(3 * DAY);
    expect(isUsableAt(m, [], shift(END, DAY))).toBe(true);
    expect(isUsableAt(m, [], shift(pastDueSince, 3 * DAY - 1))).toBe(true);
    expect(isUsableAt(m, [], shift(pastDueSince, 3 * DAY))).toBe(false);
  });

  it("denies PAST_DUE without pastDueSince", () => {
    expect(isUsableAt(stripeSubscription({ status: "PAST_DUE" }), [], START)).toBe(false);
  });

  it.each<MembershipStatus>(["FROZEN", "CANCELLED", "EXPIRED"])("never grants access when %s", (status) => {
    const m = membership({ status, pastDueSince: START });
    expect(isUsableAt(m, [], shift(START, DAY))).toBe(false);
  });

  it("denies access inside an approved freeze window", () => {
    const freezes = [freeze("2027-01-10T22:00:00Z", "2027-01-15T22:00:00Z")];
    const m = membership();
    expect(isUsableAt(m, freezes, at("2027-01-10T21:59:59.999Z"))).toBe(true);
    expect(isUsableAt(m, freezes, at("2027-01-10T22:00:00Z"))).toBe(false);
    expect(isUsableAt(m, freezes, at("2027-01-15T21:59:59.999Z"))).toBe(false);
    expect(isUsableAt(m, freezes, at("2027-01-15T22:00:00Z"))).toBe(true);
  });

  it("treats a COMPLETED freeze like an approved one", () => {
    const freezes = [freeze("2027-01-10T22:00:00Z", "2027-01-15T22:00:00Z", "COMPLETED")];
    expect(isUsableAt(membership(), freezes, at("2027-01-12T12:00:00Z"))).toBe(false);
  });

  it.each<FreezeStatus>(["REQUESTED", "REJECTED", "CANCELLED"])("ignores a %s freeze", (status) => {
    const freezes = [freeze("2027-01-10T22:00:00Z", "2027-01-15T22:00:00Z", status)];
    expect(isUsableAt(membership(), freezes, at("2027-01-12T12:00:00Z"))).toBe(true);
  });

  it("denies PAST_DUE access inside an approved freeze window", () => {
    const m = stripeSubscription({ status: "PAST_DUE", pastDueSince: at("2027-01-10T00:00:00Z") });
    const freezes = [freeze("2027-01-10T22:00:00Z", "2027-01-15T22:00:00Z")];
    expect(isUsableAt(m, freezes, at("2027-01-10T12:00:00Z"))).toBe(true);
    expect(isUsableAt(m, freezes, at("2027-01-11T12:00:00Z"))).toBe(false);
  });
});

describe("isOverdue", () => {
  it("is true for a non-renewing membership from its period end on", () => {
    const m = membership();
    expect(isOverdue(m, shift(END, -1))).toBe(false);
    expect(isOverdue(m, END)).toBe(true);
  });

  it("is false for an auto-renewing subscription past its period end", () => {
    expect(isOverdue(stripeSubscription(), shift(END, DAY))).toBe(false);
  });

  it("is true for a subscription set to cancel at period end", () => {
    expect(isOverdue(stripeSubscription({ cancelAtPeriodEnd: true }), END)).toBe(true);
  });

  it("is false once the membership is marked ended", () => {
    expect(isOverdue(membership({ status: "EXPIRED" }), shift(END, DAY))).toBe(false);
  });
});

describe("overdueEndStatus", () => {
  it("is CANCELLED for a subscription cancelled at period end, otherwise EXPIRED", () => {
    expect(overdueEndStatus({ cancelAtPeriodEnd: true })).toBe("CANCELLED");
    expect(overdueEndStatus({ cancelAtPeriodEnd: false })).toBe("EXPIRED");
  });
});

describe("effectiveStatus", () => {
  const freezes = [freeze("2027-01-10T22:00:00Z", "2027-01-15T22:00:00Z")];

  it("shows the stored status of an ended membership", () => {
    expect(effectiveStatus(membership({ status: "CANCELLED" }), freezes, at("2027-01-12T12:00:00Z"))).toBe("CANCELLED");
    expect(effectiveStatus(membership({ status: "EXPIRED" }), [], START)).toBe("EXPIRED");
  });

  it("shows an overdue membership as ended", () => {
    expect(effectiveStatus(membership(), [], END)).toBe("EXPIRED");
    expect(effectiveStatus(stripeSubscription({ cancelAtPeriodEnd: true }), [], END)).toBe("CANCELLED");
  });

  it("shows FROZEN only inside an approved freeze window", () => {
    expect(effectiveStatus(membership(), freezes, at("2027-01-10T21:59:59.999Z"))).toBe("ACTIVE");
    expect(effectiveStatus(membership(), freezes, at("2027-01-10T22:00:00Z"))).toBe("FROZEN");
    expect(effectiveStatus(membership(), freezes, at("2027-01-15T22:00:00Z"))).toBe("ACTIVE");
    const requested = [freeze("2027-01-10T22:00:00Z", "2027-01-15T22:00:00Z", "REQUESTED")];
    expect(effectiveStatus(membership(), requested, at("2027-01-12T12:00:00Z"))).toBe("ACTIVE");
  });

  it("keeps ACTIVE and PAST_DUE otherwise", () => {
    expect(effectiveStatus(membership(), [], START)).toBe("ACTIVE");
    expect(effectiveStatus(stripeSubscription(), [], shift(END, DAY))).toBe("ACTIVE");
    const pastDue = stripeSubscription({ status: "PAST_DUE", pastDueSince: START });
    expect(effectiveStatus(pastDue, [], shift(START, DAY))).toBe("PAST_DUE");
  });
});

describe("canBookAt", () => {
  const now = at("2027-01-20T08:00:00Z");

  it("requires a non-renewing membership to be usable now and at class start", () => {
    const m = membership();
    expect(canBookAt(m, [], now, shift(END, -1))).toBe(true);
    expect(canBookAt(m, [], now, END)).toBe(false);
    expect(canBookAt(m, [], shift(START, -DAY), shift(START, HOUR))).toBe(false);
  });

  it("applies the class-start check to credit packs", () => {
    const pack = membership({ plan: { billing: "ONE_TIME" } });
    expect(canBookAt(pack, [], now, shift(END, -HOUR))).toBe(true);
    expect(canBookAt(pack, [], now, shift(END, HOUR))).toBe(false);
  });

  it("lets an auto-renewing subscription book past its period end", () => {
    expect(canBookAt(stripeSubscription(), [], now, shift(END, 2 * DAY))).toBe(true);
  });

  it("rejects a class starting inside an approved freeze window", () => {
    const freezes = [freeze("2027-01-24T22:00:00Z", "2027-01-26T22:00:00Z")];
    const classStart = at("2027-01-25T16:00:00Z");
    expect(canBookAt(membership(), freezes, now, classStart)).toBe(false);
    expect(canBookAt(stripeSubscription(), freezes, now, classStart)).toBe(false);
    expect(canBookAt(membership(), freezes, now, at("2027-01-27T16:00:00Z"))).toBe(true);
  });

  it("rejects booking while frozen now", () => {
    const freezes = [freeze("2027-01-19T22:00:00Z", "2027-01-21T22:00:00Z")];
    expect(canBookAt(membership(), freezes, now, at("2027-01-23T16:00:00Z"))).toBe(false);
    expect(canBookAt(stripeSubscription(), freezes, now, at("2027-01-23T16:00:00Z"))).toBe(false);
  });

  it("rejects ended memberships", () => {
    expect(canBookAt(membership({ status: "CANCELLED" }), [], now, shift(now, HOUR))).toBe(false);
  });
});

describe("remainingUsableMs", () => {
  const now = at("2027-01-20T08:00:00Z");

  it("is the time to the period end without freezes", () => {
    expect(remainingUsableMs(membership(), [], now)).toBe(12 * DAY);
  });

  it("excludes a future approved freeze", () => {
    const freezes = [freeze("2027-01-24T08:00:00Z", "2027-01-29T08:00:00Z")];
    expect(remainingUsableMs(membership(), freezes, now)).toBe(7 * DAY);
  });

  it("excludes only the part of a running freeze not yet elapsed", () => {
    const freezes = [freeze("2027-01-18T08:00:00Z", "2027-01-23T08:00:00Z")];
    expect(remainingUsableMs(membership(), freezes, now)).toBe(9 * DAY);
  });

  it("clips a freeze to the period and ignores past or unapproved ones", () => {
    const freezes = [
      freeze("2027-01-30T08:00:00Z", "2027-02-05T08:00:00Z"),
      freeze("2027-01-05T08:00:00Z", "2027-01-10T08:00:00Z"),
      freeze("2027-01-21T08:00:00Z", "2027-01-23T08:00:00Z", "REQUESTED"),
    ];
    expect(remainingUsableMs(membership(), freezes, now)).toBe(10 * DAY);
  });

  it("counts overlapping freeze windows once", () => {
    const freezes = [
      freeze("2027-01-22T08:00:00Z", "2027-01-25T08:00:00Z"),
      freeze("2027-01-24T08:00:00Z", "2027-01-26T08:00:00Z", "COMPLETED"),
    ];
    expect(remainingUsableMs(membership(), freezes, now)).toBe(8 * DAY);
  });

  it("counts from the period start when it hasn't begun", () => {
    expect(remainingUsableMs(membership(), [], shift(START, -5 * DAY))).toBe(END.getTime() - START.getTime());
  });

  it("is the remaining grace for PAST_DUE", () => {
    const m = stripeSubscription({ status: "PAST_DUE", pastDueSince: now });
    expect(remainingUsableMs(m, [], shift(now, DAY))).toBe(2 * DAY);
  });

  it("is zero once the membership is overdue or ended", () => {
    expect(remainingUsableMs(membership(), [], END)).toBe(0);
    expect(remainingUsableMs(membership({ status: "CANCELLED" }), [], now)).toBe(0);
    expect(remainingUsableMs(membership({ status: "FROZEN" }), [], now)).toBe(0);
  });
});

describe("closingTimeOn", () => {
  it("returns the closing instant for the local weekday", () => {
    const mondaysOnly = clock({ 1: [6 * 60, 22 * 60] });
    expect(closingTimeOn({ year: 2027, month: 1, day: 18 }, mondaysOnly)).toEqual(at("2027-01-18T20:00:00Z"));
  });

  it("returns null on a closed day", () => {
    const mondaysOnly = clock({ 1: [6 * 60, 22 * 60] });
    expect(closingTimeOn({ year: 2027, month: 1, day: 19 }, mondaysOnly)).toBeNull();
  });

  it("reads closes_at_min = 1440 as the next local midnight", () => {
    expect(closingTimeOn({ year: 2027, month: 1, day: 18 }, everyDay(360, 1440))).toEqual(at("2027-01-18T22:00:00Z"));
  });

  it("uses the summer offset on the DST start day", () => {
    expect(closingTimeOn({ year: 2027, month: 3, day: 28 }, SIX_TO_TEN)).toEqual(at("2027-03-28T19:00:00Z"));
  });

  it("closes at the end of the day when midnight falls in the DST gap", () => {
    expect(closingTimeOn({ year: 2027, month: 3, day: 27 }, everyDay(360, 1440))).toEqual(at("2027-03-27T22:00:00Z"));
  });

  it("closes after the repeated hour on the DST end day", () => {
    expect(closingTimeOn({ year: 2027, month: 10, day: 30 }, everyDay(360, 1440))).toEqual(at("2027-10-30T22:00:00Z"));
  });
});

describe("computePeriod", () => {
  describe("recurring plans", () => {
    it("adds calendar months at the same local time", () => {
      const start = at("2027-01-15T08:00:00Z");
      expect(computePeriod(recurring(1), start, SIX_TO_TEN)).toEqual({ start, end: at("2027-02-15T08:00:00Z") });
      expect(computePeriod(recurring(12), start, SIX_TO_TEN)?.end).toEqual(at("2028-01-15T08:00:00Z"));
    });

    it("clamps to the end of a shorter month", () => {
      expect(computePeriod(recurring(1), at("2027-01-31T08:00:00Z"), SIX_TO_TEN)?.end).toEqual(at("2027-02-28T08:00:00Z"));
      expect(computePeriod(recurring(1), at("2028-01-31T08:00:00Z"), SIX_TO_TEN)?.end).toEqual(at("2028-02-29T08:00:00Z"));
      expect(computePeriod(recurring(3), at("2027-11-30T08:00:00Z"), SIX_TO_TEN)?.end).toEqual(at("2028-02-29T08:00:00Z"));
    });

    it("keeps the local time across DST start and end", () => {
      expect(computePeriod(recurring(1), at("2027-03-15T08:00:00Z"), SIX_TO_TEN)?.end).toEqual(at("2027-04-15T07:00:00Z"));
      expect(computePeriod(recurring(1), at("2027-10-15T07:00:00Z"), SIX_TO_TEN)?.end).toEqual(at("2027-11-15T08:00:00Z"));
    });

    it("resolves an end inside the DST gap forward", () => {
      // 28 Feb 00:30 local + 1 month = 28 Mar 00:30, which doesn't exist; it becomes 01:30.
      expect(computePeriod(recurring(1), at("2027-02-27T22:30:00Z"), SIX_TO_TEN)?.end).toEqual(at("2027-03-27T22:30:00Z"));
    });

    it("doesn't depend on opening hours", () => {
      const start = at("2027-01-15T08:00:00Z");
      expect(computePeriod(recurring(1), start, clock({}))?.end).toEqual(at("2027-02-15T08:00:00Z"));
    });
  });

  describe("rolling one-time plans", () => {
    it("adds calendar days at the same local time", () => {
      const start = at("2027-01-15T08:00:00Z");
      expect(computePeriod(rolling(60), start, SIX_TO_TEN)).toEqual({ start, end: at("2027-03-16T08:00:00Z") });
    });

    it("keeps the local time across DST start", () => {
      const start = at("2027-03-25T16:00:00Z");
      const period = computePeriod(rolling(7), start, SIX_TO_TEN);
      expect(period?.end).toEqual(at("2027-04-01T15:00:00Z"));
      expect(period!.end.getTime() - start.getTime()).toBe(7 * DAY - HOUR);
    });
  });

  describe("calendar-day plans", () => {
    it("end at the start day's closing time", () => {
      const start = at("2027-01-15T07:30:00Z");
      expect(computePeriod(calendarDay, start, SIX_TO_TEN)).toEqual({ start, end: at("2027-01-15T20:00:00Z") });
    });

    it("can start before opening", () => {
      const start = at("2027-01-15T03:00:00Z");
      expect(computePeriod(calendarDay, start, SIX_TO_TEN)?.end).toEqual(at("2027-01-15T20:00:00Z"));
    });

    it("can't start at or after closing", () => {
      expect(computePeriod(calendarDay, at("2027-01-15T19:59:59.999Z"), SIX_TO_TEN)).not.toBeNull();
      expect(computePeriod(calendarDay, at("2027-01-15T20:00:00Z"), SIX_TO_TEN)).toBeNull();
      expect(computePeriod(calendarDay, at("2027-01-15T21:30:00Z"), SIX_TO_TEN)).toBeNull();
    });

    it("can't start on a closed day", () => {
      const weekdaysOnly = clock({ 1: [360, 1320], 2: [360, 1320], 3: [360, 1320], 4: [360, 1320], 5: [360, 1320] });
      expect(computePeriod(calendarDay, at("2027-01-16T08:00:00Z"), weekdaysOnly)).toBeNull();
      expect(computePeriod(calendarDay, at("2027-01-15T08:00:00Z"), weekdaysOnly)).not.toBeNull();
    });

    it("use the local date, not the UTC date", () => {
      // 23:30 UTC on Friday is 01:30 local on Saturday.
      const saturdayOnly = clock({ 6: [0, 1440] });
      expect(computePeriod(calendarDay, at("2027-01-15T23:30:00Z"), saturdayOnly)?.end).toEqual(at("2027-01-16T22:00:00Z"));
    });

    it("end at local midnight with closes_at_min = 1440", () => {
      expect(computePeriod(calendarDay, at("2027-01-15T21:30:00Z"), everyDay(360, 1440))?.end).toEqual(
        at("2027-01-15T22:00:00Z"),
      );
    });

    it("handle the DST start day", () => {
      const start = at("2027-03-28T07:00:00Z");
      const period = computePeriod(calendarDay, start, SIX_TO_TEN);
      expect(period?.end).toEqual(at("2027-03-28T19:00:00Z"));
    });

    it("handle the DST end day, including the repeated hour", () => {
      const late = everyDay(360, 1440);
      expect(computePeriod(calendarDay, at("2027-10-30T20:30:00Z"), late)?.end).toEqual(at("2027-10-30T22:00:00Z"));
      expect(computePeriod(calendarDay, at("2027-10-30T21:30:00Z"), late)?.end).toEqual(at("2027-10-30T22:00:00Z"));
    });
  });

  it("rejects plan shapes the database doesn't allow", () => {
    const start = at("2027-01-15T08:00:00Z");
    expect(() => computePeriod({ ...recurring(1), intervalMonths: null }, start, SIX_TO_TEN)).toThrow(RangeError);
    expect(() => computePeriod({ ...rolling(7), durationMode: null }, start, SIX_TO_TEN)).toThrow(RangeError);
    expect(() => computePeriod({ ...rolling(7), durationDays: 0 }, start, SIX_TO_TEN)).toThrow(RangeError);
    expect(() => computePeriod({ ...calendarDay, durationDays: 2 }, start, SIX_TO_TEN)).toThrow(RangeError);
  });
});
