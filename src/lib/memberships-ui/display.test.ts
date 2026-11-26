import { describe, expect, it } from "vitest";
import type { FreezeStatus, MembershipStatus } from "@/generated/prisma/client";
import type { OpenBaseReplacement } from "@/lib/services/memberships/rules";
import { startOfZonedDay, type LocalDate } from "@/lib/time";
import {
  canCancelFreeze,
  correctionEffect,
  freezeDayCount,
  freezeDaysText,
  freezeLastDay,
  periodText,
  recordPaymentNotice,
  refundEffectText,
} from "./display";
import { CONFLICT_REASON_MESSAGES } from "./messages";

const TZ = "Asia/Beirut";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Wednesday 2 December 2026, 10:00 in Beirut (UTC+2).
const NOW = new Date("2026-12-02T08:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

function freeze(first: LocalDate, last: LocalDate) {
  return {
    startsAt: startOfZonedDay(first, TZ),
    endsAt: startOfZonedDay({ year: last.year, month: last.month, day: last.day + 1 }, TZ),
  };
}

describe("periodText", () => {
  it("shows the period as local dates", () => {
    const text = periodText(
      { currentPeriodStart: NOW, currentPeriodEnd: new Date("2027-01-02T08:00:00.000Z"), endsAtClosing: false },
      TZ,
      NOW,
    );
    expect(text).toBe("2 Dec 2026 – 2 Jan 2027");
  });

  it("uses the local date, not the UTC one", () => {
    const text = periodText(
      { currentPeriodStart: new Date("2026-12-01T22:30:00.000Z"), currentPeriodEnd: new Date("2027-01-01T22:30:00.000Z"), endsAtClosing: false },
      TZ,
      NOW,
    );
    expect(text).toBe("2 Dec 2026 – 2 Jan 2027");
  });

  it("shows a pass that ends at closing as valid today on its day", () => {
    const closing = new Date("2026-12-02T20:00:00.000Z");
    expect(periodText({ currentPeriodStart: NOW, currentPeriodEnd: closing, endsAtClosing: true }, TZ, NOW)).toBe(
      "Valid today until closing (22:00)",
    );
  });

  it("dates a closing-time pass from another day", () => {
    const closing = new Date("2026-12-02T20:00:00.000Z");
    expect(periodText({ currentPeriodStart: NOW, currentPeriodEnd: closing, endsAtClosing: true }, TZ, at(DAY))).toBe(
      "2 Dec 2026, until closing (22:00)",
    );
  });
});

describe("freeze days", () => {
  it("counts whole days and shows the first and last day", () => {
    const f = freeze({ year: 2026, month: 12, day: 4 }, { year: 2026, month: 12, day: 10 });
    expect(freezeDayCount(f, TZ)).toBe(7);
    expect(freezeDaysText(f, TZ)).toBe("4 Dec 2026 – 10 Dec 2026 (7 days)");
  });

  it("shows a one-day freeze as a single date", () => {
    const f = freeze({ year: 2026, month: 12, day: 4 }, { year: 2026, month: 12, day: 4 });
    expect(freezeDaysText(f, TZ)).toBe("4 Dec 2026 (1 day)");
  });

  it("crosses a month and year end", () => {
    const f = freeze({ year: 2026, month: 12, day: 30 }, { year: 2027, month: 1, day: 2 });
    expect(freezeDaysText(f, TZ)).toBe("30 Dec 2026 – 2 Jan 2027 (4 days)");
  });

  describe("across DST (Beirut: midnight is skipped on 28 Mar 2027 and repeated hours end 24 Oct 2026)", () => {
    it("counts a freeze over the spring gap", () => {
      const f = freeze({ year: 2027, month: 3, day: 27 }, { year: 2027, month: 3, day: 29 });
      expect(f.endsAt.getTime() - f.startsAt.getTime()).toBe(3 * DAY - HOUR);
      expect(freezeDaysText(f, TZ)).toBe("27 Mar 2027 – 29 Mar 2027 (3 days)");
    });

    it("finds the last day when that day starts after the gap", () => {
      const f = freeze({ year: 2027, month: 3, day: 26 }, { year: 2027, month: 3, day: 28 });
      expect(freezeLastDay(f, TZ).toISOString()).toBe("2027-03-27T22:00:00.000Z");
      expect(freezeDaysText(f, TZ)).toBe("26 Mar 2027 – 28 Mar 2027 (3 days)");
    });

    it("counts a freeze that starts on the gap day", () => {
      const f = freeze({ year: 2027, month: 3, day: 28 }, { year: 2027, month: 3, day: 28 });
      expect(freezeDaysText(f, TZ)).toBe("28 Mar 2027 (1 day)");
    });

    it("counts a freeze over the autumn overlap", () => {
      const f = freeze({ year: 2026, month: 10, day: 24 }, { year: 2026, month: 10, day: 26 });
      expect(f.endsAt.getTime() - f.startsAt.getTime()).toBe(3 * DAY + HOUR);
      expect(freezeDaysText(f, TZ)).toBe("24 Oct 2026 – 26 Oct 2026 (3 days)");
    });

    it("counts the longest freeze over a DST change", () => {
      const f = freeze({ year: 2027, month: 3, day: 15 }, { year: 2027, month: 4, day: 13 });
      expect(freezeDayCount(f, TZ)).toBe(30);
    });
  });
});

describe("canCancelFreeze", () => {
  const future = { startsAt: at(2 * DAY), endsAt: at(5 * DAY) };
  const started = { startsAt: at(-DAY), endsAt: at(2 * DAY) };

  it.each<[FreezeStatus, boolean]>([
    ["REQUESTED", true],
    ["APPROVED", true],
    ["REJECTED", false],
    ["CANCELLED", false],
    ["COMPLETED", false],
  ])("a future %s freeze: %s", (status, expected) => {
    expect(canCancelFreeze({ status, ...future }, NOW)).toBe(expected);
  });

  it("not once the freeze has started (approved) or lapsed (requested)", () => {
    expect(canCancelFreeze({ status: "APPROVED", ...started }, NOW)).toBe(false);
    expect(canCancelFreeze({ status: "REQUESTED", ...started }, NOW)).toBe(false);
  });

  it("not at the start instant", () => {
    expect(canCancelFreeze({ status: "APPROVED", startsAt: NOW, endsAt: at(DAY) }, NOW)).toBe(false);
  });
});

describe("correctionEffect and refundEffectText", () => {
  const running = (status: MembershipStatus = "ACTIVE") => ({ status, currentPeriodStart: at(-40 * DAY) });
  const payment = (periodStart: Date | null) => ({ periodStart, amountCents: 3000 });

  it("cancels when the payment activated the membership", () => {
    expect(correctionEffect(payment(at(-40 * DAY)), running(), TZ, NOW)).toBe("This cancels the membership.");
    expect(correctionEffect(payment(at(-41 * DAY)), running(), TZ, NOW)).toBe("This cancels the membership.");
  });

  it("moves the end back to the payment's period start", () => {
    expect(correctionEffect(payment(new Date("2026-12-20T08:00:00.000Z")), running(), TZ, NOW)).toBe(
      "The membership's end moves back to 20 Dec 2026.",
    );
  });

  it("treats a frozen membership as running", () => {
    expect(correctionEffect(payment(at(10 * DAY)), running("FROZEN"), TZ, NOW)).toContain("end moves back to 12 Dec 2026");
  });

  it("ends the membership when the new end has passed", () => {
    expect(correctionEffect(payment(at(-10 * DAY)), running(), TZ, NOW)).toBe(
      "The membership's end moves back to 22 Nov 2026, which has passed, so it ends now.",
    );
  });

  it.each<MembershipStatus>(["CANCELLED", "EXPIRED"])("leaves a %s membership as it is", (status) => {
    expect(correctionEffect(payment(at(-40 * DAY)), running(status), TZ, NOW)).toBe("The membership has ended, so it stays as it is.");
  });

  it("a full refund says what a void says", () => {
    const p = payment(new Date("2026-12-20T08:00:00.000Z"));
    const text = refundEffectText(3000, p, running(), TZ, NOW);
    expect(text).toContain(correctionEffect(p, running(), TZ, NOW));
    expect(refundEffectText(3000, payment(at(-40 * DAY)), running(), TZ, NOW)).toContain("This cancels the membership.");
  });

  it("a partial or unparsed amount changes only the amounts", () => {
    const p = payment(at(-40 * DAY));
    for (const amount of [1, 2999, null]) {
      const text = refundEffectText(amount, p, running(), TZ, NOW);
      expect(text).toBe("A partial refund changes only the amounts; the membership stays as it is.");
    }
  });
});

describe("recordPaymentNotice", () => {
  const openBase = { planName: "Basic", remainingDays: 12, hasPartner: false };
  const plan = (replacement: OpenBaseReplacement, closedForToday = false) => ({ name: "Premium", replacement, closedForToday });

  it("says nothing when no open base is affected", () => {
    expect(recordPaymentNotice(plan({ action: "none" }), null)).toBeNull();
  });

  it("supersede: the trial or Day Pass ends now", () => {
    const notice = recordPaymentNotice(plan({ action: "supersede" }), { ...openBase, planName: "Gym Trial" });
    expect(notice).toMatchObject({ tone: "info", text: "Their Gym Trial ends now.", blocked: false, needsConfirm: false });
  });

  it("switch: warns with the days lost and asks for confirmation", () => {
    const notice = recordPaymentNotice(plan({ action: "switch" }), openBase);
    expect(notice).toEqual({
      tone: "warning",
      text: "Basic ends now and 12 days left will be lost; paid time isn't refunded.",
      blocked: false,
      needsConfirm: true,
      confirmTitle: "Switch Basic to Premium?",
      confirmText: "Basic ends now and 12 days left will be lost; paid time isn't refunded.",
    });
  });

  it("switch: mentions the partner who will be removed", () => {
    const notice = recordPaymentNotice(plan({ action: "switch" }), { ...openBase, hasPartner: true });
    expect(notice?.confirmText).toContain("The partner will be removed.");
  });

  it("same plan: points to Extend and blocks submit", () => {
    const notice = recordPaymentNotice(plan({ action: "same_plan" }), { ...openBase, planName: "Premium" });
    expect(notice).toMatchObject({ tone: "info", blocked: true, needsConfirm: false });
    expect(notice?.text).toMatch(/extend/i);
  });

  it.each(Object.keys(CONFLICT_REASON_MESSAGES) as (keyof typeof CONFLICT_REASON_MESSAGES)[])(
    "conflict %s: explains and blocks submit",
    (reason) => {
      const notice = recordPaymentNotice(plan({ action: "conflict", reason }), openBase);
      expect(notice).toMatchObject({ tone: "error", text: CONFLICT_REASON_MESSAGES[reason], blocked: true, needsConfirm: false });
    },
  );

  it("closed for today blocks submit, whatever the replacement", () => {
    for (const replacement of [{ action: "none" }, { action: "supersede" }] as const) {
      const notice = recordPaymentNotice({ name: "Day Pass", replacement, closedForToday: true }, null);
      expect(notice).toMatchObject({ tone: "warning", blocked: true, needsConfirm: false });
      expect(notice?.text).toContain("Day Pass");
    }
  });
});
