import { describe, expect, it } from "vitest";
import {
  addDaysZoned,
  addMonthsZoned,
  formatLocal,
  formatLocalTime,
  isoDate,
  localElapsedMs,
  localMinutes,
  startOfZonedDay,
  zonedParts,
  zonedToInstant,
} from "./time";

const BEIRUT = "Asia/Beirut";
const NEW_YORK = "America/New_York";
const HOUR = 3_600_000;

const at = (iso: string) => new Date(iso);

// Asia/Beirut is UTC+2 in winter and UTC+3 in summer. In 2027 its clocks jump from
// 00:00 to 01:00 on 28 March and fall back from 24:00 to 23:00 on 30 October.
// America/New_York: 02:00 -> 03:00 on 14 March 2027, 02:00 -> 01:00 on 7 November 2027.

describe("zonedParts", () => {
  it("returns the local date, time, and ISO weekday", () => {
    expect(zonedParts(at("2027-01-15T07:30:15.250Z"), BEIRUT)).toEqual({
      year: 2027, month: 1, day: 15, hour: 9, minute: 30, second: 15, millisecond: 250, weekday: 5,
    });
    expect(zonedParts(at("2027-07-15T06:30:00Z"), BEIRUT)).toMatchObject({ day: 15, hour: 9, minute: 30 });
  });

  it("numbers Monday 1 and Sunday 7", () => {
    expect(zonedParts(at("2027-03-28T21:00:00Z"), BEIRUT)).toMatchObject({ day: 29, hour: 0, weekday: 1 });
    expect(zonedParts(at("2027-03-28T20:59:59Z"), BEIRUT)).toMatchObject({ day: 28, hour: 23, weekday: 7 });
  });

  it("reports midnight as hour 0", () => {
    expect(zonedParts(at("2027-01-14T22:00:00Z"), BEIRUT)).toMatchObject({ day: 15, hour: 0, minute: 0 });
  });

  it("follows the DST transitions", () => {
    expect(zonedParts(at("2027-03-27T21:59:59.999Z"), BEIRUT)).toMatchObject({
      day: 27, hour: 23, minute: 59, second: 59, millisecond: 999, weekday: 6,
    });
    expect(zonedParts(at("2027-03-27T22:00:00Z"), BEIRUT)).toMatchObject({ day: 28, hour: 1, minute: 0, weekday: 7 });
    expect(zonedParts(at("2027-10-30T20:30:00Z"), BEIRUT)).toMatchObject({ day: 30, hour: 23, minute: 30 });
    expect(zonedParts(at("2027-10-30T21:30:00Z"), BEIRUT)).toMatchObject({ day: 30, hour: 23, minute: 30 });
  });

  it("crosses the date line in either direction", () => {
    expect(zonedParts(at("2026-12-31T10:00:00Z"), "Pacific/Kiritimati")).toMatchObject({
      year: 2027, month: 1, day: 1, hour: 0, weekday: 5,
    });
    expect(zonedParts(at("2027-01-01T05:00:00Z"), "America/Los_Angeles")).toMatchObject({
      year: 2026, month: 12, day: 31, hour: 21, weekday: 4,
    });
  });

  it("handles years before the common era", () => {
    const instant = new Date(0);
    instant.setUTCFullYear(-5, 0, 1);
    expect(zonedParts(instant, "UTC")).toMatchObject({ year: -5, month: 1, day: 1 });
  });

  it("rejects an invalid date or time zone", () => {
    expect(() => zonedParts(new Date(Number.NaN), BEIRUT)).toThrow(RangeError);
    expect(() => zonedParts(at("2027-01-01T00:00:00Z"), "Not/AZone")).toThrow(RangeError);
  });
});

describe("zonedToInstant", () => {
  it("converts a local date and time to an instant", () => {
    expect(zonedToInstant({ year: 2027, month: 1, day: 15, hour: 9, minute: 30 }, BEIRUT)).toEqual(
      at("2027-01-15T07:30:00Z"),
    );
    expect(zonedToInstant({ year: 2027, month: 7, day: 15, hour: 9, minute: 30 }, BEIRUT)).toEqual(
      at("2027-07-15T06:30:00Z"),
    );
    expect(
      zonedToInstant({ year: 2027, month: 7, day: 15, hour: 9, minute: 30, second: 5, millisecond: 7 }, BEIRUT),
    ).toEqual(at("2027-07-15T06:30:05.007Z"));
  });

  it("defaults the time to midnight", () => {
    expect(zonedToInstant({ year: 2027, month: 7, day: 15 }, BEIRUT)).toEqual(at("2027-07-14T21:00:00Z"));
  });

  it("resolves a time in a DST gap forward by the gap's length", () => {
    expect(zonedToInstant({ year: 2027, month: 3, day: 28, hour: 0, minute: 0 }, BEIRUT)).toEqual(
      at("2027-03-27T22:00:00Z"),
    );
    expect(zonedToInstant({ year: 2027, month: 3, day: 28, hour: 0, minute: 30 }, BEIRUT)).toEqual(
      at("2027-03-27T22:30:00Z"),
    );
    expect(zonedToInstant({ year: 2027, month: 3, day: 14, hour: 2, minute: 30 }, NEW_YORK)).toEqual(
      at("2027-03-14T07:30:00Z"),
    );
  });

  it("resolves a repeated time in a DST overlap to the earlier instant", () => {
    expect(zonedToInstant({ year: 2027, month: 10, day: 30, hour: 23, minute: 30 }, BEIRUT)).toEqual(
      at("2027-10-30T20:30:00Z"),
    );
    expect(zonedToInstant({ year: 2027, month: 11, day: 7, hour: 1, minute: 30 }, NEW_YORK)).toEqual(
      at("2027-11-07T05:30:00Z"),
    );
  });

  it("rolls out-of-range fields over", () => {
    expect(zonedToInstant({ year: 2027, month: 7, day: 15, minute: 1440 }, BEIRUT)).toEqual(
      at("2027-07-15T21:00:00Z"),
    );
    expect(zonedToInstant({ year: 2027, month: 12, day: 31, hour: 24 }, BEIRUT)).toEqual(
      at("2027-12-31T22:00:00Z"),
    );
    expect(zonedToInstant({ year: 2027, month: 3, day: 27, minute: 1440 }, BEIRUT)).toEqual(
      at("2027-03-27T22:00:00Z"),
    );
  });

  it("round-trips every hour of a year", () => {
    for (const timeZone of [BEIRUT, NEW_YORK]) {
      let repeated = 0;
      for (let ms = Date.UTC(2027, 0, 1); ms < Date.UTC(2028, 0, 1); ms += HOUR) {
        const parts = zonedParts(new Date(ms), timeZone);
        const resolved = zonedToInstant(parts, timeZone).getTime();
        expect(zonedParts(new Date(resolved), timeZone)).toEqual(parts);
        if (resolved !== ms) {
          expect(resolved).toBe(ms - HOUR);
          repeated++;
        }
      }
      expect(repeated).toBe(1);
    }
  });

  it("rejects non-integer fields", () => {
    expect(() => zonedToInstant({ year: 2027, month: 1, day: 1, hour: 1.5 }, BEIRUT)).toThrow(RangeError);
    expect(() => zonedToInstant({ year: 2027, month: Number.NaN, day: 1 }, BEIRUT)).toThrow(RangeError);
  });
});

describe("addDaysZoned", () => {
  it("keeps the local time across a DST start (a 23-hour day)", () => {
    const start = at("2027-03-27T07:00:00Z");
    const next = addDaysZoned(start, 1, BEIRUT);
    expect(next).toEqual(at("2027-03-28T06:00:00Z"));
    expect(next.getTime() - start.getTime()).toBe(23 * HOUR);
    expect(addDaysZoned(next, -1, BEIRUT)).toEqual(start);
  });

  it("keeps the local time across a DST end (a 25-hour day)", () => {
    const start = at("2027-10-30T06:00:00Z");
    const next = addDaysZoned(start, 1, BEIRUT);
    expect(next).toEqual(at("2027-10-31T07:00:00Z"));
    expect(next.getTime() - start.getTime()).toBe(25 * HOUR);
  });

  it("adds rolling days across months and years", () => {
    expect(addDaysZoned(at("2027-03-25T10:15:00Z"), 7, BEIRUT)).toEqual(at("2027-04-01T09:15:00Z"));
    expect(addDaysZoned(at("2027-12-31T08:00:00Z"), 1, BEIRUT)).toEqual(at("2028-01-01T08:00:00Z"));
    expect(addDaysZoned(at("2027-01-15T08:00:00Z"), 60, BEIRUT)).toEqual(at("2027-03-16T08:00:00Z"));
  });

  it("moves a local time that lands in a DST gap forward", () => {
    expect(addDaysZoned(at("2027-03-26T22:30:00Z"), 1, BEIRUT)).toEqual(at("2027-03-27T22:30:00Z"));
  });

  it("returns the same instant for zero days and rejects fractions", () => {
    expect(addDaysZoned(at("2027-05-05T05:05:05.005Z"), 0, BEIRUT)).toEqual(at("2027-05-05T05:05:05.005Z"));
    expect(() => addDaysZoned(at("2027-05-05T05:00:00Z"), 0.5, BEIRUT)).toThrow(RangeError);
  });
});

describe("addMonthsZoned", () => {
  it("clamps to the end of a shorter month", () => {
    expect(addMonthsZoned(at("2027-01-31T08:00:00Z"), 1, BEIRUT)).toEqual(at("2027-02-28T08:00:00Z"));
    expect(addMonthsZoned(at("2028-01-31T08:00:00Z"), 1, BEIRUT)).toEqual(at("2028-02-29T08:00:00Z"));
    expect(addMonthsZoned(at("2027-05-31T07:00:00Z"), 1, BEIRUT)).toEqual(at("2027-06-30T07:00:00Z"));
    expect(addMonthsZoned(at("2028-02-29T08:00:00Z"), 12, BEIRUT)).toEqual(at("2029-02-28T08:00:00Z"));
  });

  it("does not carry the clamp into later months when counted from the anchor", () => {
    const anchor = at("2027-01-31T08:00:00Z");
    expect(addMonthsZoned(anchor, 2, BEIRUT)).toEqual(at("2027-03-31T07:00:00Z"));
    expect(addMonthsZoned(addMonthsZoned(anchor, 1, BEIRUT), 1, BEIRUT)).toEqual(at("2027-03-28T07:00:00Z"));
  });

  it("keeps the local time across DST changes", () => {
    expect(addMonthsZoned(at("2027-03-15T08:00:00Z"), 1, BEIRUT)).toEqual(at("2027-04-15T07:00:00Z"));
    expect(addMonthsZoned(at("2027-10-15T07:00:00Z"), 1, BEIRUT)).toEqual(at("2027-11-15T08:00:00Z"));
  });

  it("crosses year boundaries in both directions", () => {
    expect(addMonthsZoned(at("2027-11-30T08:00:00Z"), 3, BEIRUT)).toEqual(at("2028-02-29T08:00:00Z"));
    expect(addMonthsZoned(at("2027-01-15T08:00:00Z"), -2, BEIRUT)).toEqual(at("2026-11-15T08:00:00Z"));
    expect(addMonthsZoned(at("2027-03-31T07:00:00Z"), -1, BEIRUT)).toEqual(at("2027-02-28T08:00:00Z"));
  });

  it("works from a local date that differs from the UTC date", () => {
    // 1 Feb 00:30 local is still 31 Jan in UTC.
    expect(addMonthsZoned(at("2027-01-31T22:30:00Z"), 1, BEIRUT)).toEqual(at("2027-02-28T22:30:00Z"));
  });

  it("rejects fractional months", () => {
    expect(() => addMonthsZoned(at("2027-01-15T08:00:00Z"), 1.5, BEIRUT)).toThrow(RangeError);
  });
});

describe("startOfZonedDay", () => {
  it("returns local midnight", () => {
    expect(startOfZonedDay({ year: 2027, month: 1, day: 15 }, BEIRUT)).toEqual(at("2027-01-14T22:00:00Z"));
    expect(startOfZonedDay({ year: 2027, month: 7, day: 15 }, BEIRUT)).toEqual(at("2027-07-14T21:00:00Z"));
  });

  it("returns 01:00 local when midnight falls in Beirut's DST gap", () => {
    const start = startOfZonedDay({ year: 2027, month: 3, day: 28 }, BEIRUT);
    expect(start).toEqual(at("2027-03-27T22:00:00Z"));
    expect(zonedParts(start, BEIRUT)).toMatchObject({ day: 28, hour: 1, minute: 0 });
    expect(zonedParts(new Date(start.getTime() - 1), BEIRUT)).toMatchObject({ day: 27, hour: 23 });
  });

  it("handles the days around the DST end", () => {
    expect(startOfZonedDay({ year: 2027, month: 10, day: 30 }, BEIRUT)).toEqual(at("2027-10-29T21:00:00Z"));
    expect(startOfZonedDay({ year: 2027, month: 10, day: 31 }, BEIRUT)).toEqual(at("2027-10-30T22:00:00Z"));
  });

  it("uses only the date of zoned parts", () => {
    const parts = zonedParts(at("2027-07-15T12:34:56.789Z"), BEIRUT);
    expect(startOfZonedDay(parts, BEIRUT)).toEqual(at("2027-07-14T21:00:00Z"));
  });
});

describe("isoDate", () => {
  it("pads month and day", () => {
    expect(isoDate({ year: 2027, month: 3, day: 5 })).toBe("2027-03-05");
    expect(isoDate({ year: 2026, month: 12, day: 31 })).toBe("2026-12-31");
  });

  it("formats the local date of zoned parts", () => {
    expect(isoDate(zonedParts(at("2026-12-31T22:30:00Z"), BEIRUT))).toBe("2027-01-01");
  });
});

describe("localMinutes", () => {
  it("counts wall-clock minutes since local midnight", () => {
    expect(localMinutes(at("2027-01-14T22:00:00Z"), BEIRUT)).toBe(0);
    expect(localMinutes(at("2027-01-15T07:30:00Z"), BEIRUT)).toBe(570);
    expect(localMinutes(at("2027-01-15T21:59:59Z"), BEIRUT)).toBe(1439);
  });

  it("reads the wall clock on DST days", () => {
    expect(localMinutes(at("2027-03-27T22:00:00Z"), BEIRUT)).toBe(60);
    expect(localMinutes(at("2027-10-30T20:30:00Z"), BEIRUT)).toBe(1410);
    expect(localMinutes(at("2027-10-30T21:30:00Z"), BEIRUT)).toBe(1410);
  });
});

describe("localElapsedMs", () => {
  const DAY = 24 * HOUR;

  it("measures wall-clock time, ignoring DST shifts in between", () => {
    expect(localElapsedMs(at("2027-10-25T07:00:00Z"), at("2027-11-04T08:00:00Z"), BEIRUT)).toBe(10 * DAY);
    expect(localElapsedMs(at("2027-03-25T08:00:00Z"), at("2027-04-04T07:00:00Z"), BEIRUT)).toBe(10 * DAY);
    expect(localElapsedMs(at("2027-11-06T15:00:00Z"), at("2027-11-08T15:00:00Z"), NEW_YORK)).toBe(2 * DAY - HOUR);
  });

  it("equals the real duration without a DST shift, and is negative backwards", () => {
    expect(localElapsedMs(at("2027-01-15T07:30:00Z"), at("2027-01-16T09:00:00Z"), BEIRUT)).toBe(DAY + 90 * 60_000);
    expect(localElapsedMs(at("2027-01-16T09:00:00Z"), at("2027-01-15T07:30:00Z"), BEIRUT)).toBe(-(DAY + 90 * 60_000));
  });
});

describe("formatLocal", () => {
  it("formats in en-GB in the given time zone", () => {
    const instant = at("2026-07-01T21:30:00Z");
    expect(formatLocal(instant, BEIRUT)).toBe("2 Jul 2026, 00:30");
    expect(formatLocal(instant, "UTC")).toBe("1 Jul 2026, 21:30");
    expect(formatLocal(instant, BEIRUT, { dateStyle: "long" })).toBe("2 July 2026");
    expect(formatLocal(instant, BEIRUT, { timeStyle: "short" })).toBe("00:30");
  });

  it("rejects an invalid date", () => {
    expect(() => formatLocal(new Date(Number.NaN), BEIRUT)).toThrow(RangeError);
  });
});

describe("formatLocalTime", () => {
  it("formats a 24-hour HH:MM time", () => {
    expect(formatLocalTime(at("2026-07-01T21:30:00Z"), BEIRUT)).toBe("00:30");
    expect(formatLocalTime(at("2027-01-15T15:05:00Z"), BEIRUT)).toBe("17:05");
    expect(formatLocalTime(at("2027-03-27T22:00:00Z"), BEIRUT)).toBe("01:00");
  });
});
