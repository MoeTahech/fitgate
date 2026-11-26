import { describe, expect, it } from "vitest";
import {
  extendFormSchema,
  freezeRequestFormSchema,
  inviteFormSchema,
  localDaysBetween,
  parseForm,
  recordPaymentFormSchema,
  refundFormSchema,
  rejectFreezeFormSchema,
  startTrialFormSchema,
  voidFormSchema,
} from "./forms";

const ID = "0190f2a0-0000-7000-8000-000000000001";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

describe("parseForm", () => {
  it("drops unknown fields such as React's action keys", () => {
    const parsed = parseForm(voidFormSchema, form({ paymentId: ID, reason: " Typo ", $ACTION_ID_abc: "", extra: "x" }));
    expect(parsed).toEqual({ success: true, data: { paymentId: ID, reason: "Typo" } });
  });

  it("returns the first error per field", () => {
    const parsed = parseForm(voidFormSchema, form({ paymentId: "nope", reason: "  " }));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(Object.keys(parsed.fieldErrors).sort()).toEqual(["paymentId", "reason"]);
    expect(parsed.fieldErrors.reason).toBe("Enter a reason");
  });

  it("rejects a file where text is expected", () => {
    const data = form({ paymentId: ID });
    data.append("reason", new Blob(["x"]), "reason.txt");
    expect(parseForm(voidFormSchema, data).success).toBe(false);
  });
});

describe("startTrialFormSchema", () => {
  it("accepts the trial kinds only", () => {
    expect(parseForm(startTrialFormSchema, form({ kind: "GYM" })).success).toBe(true);
    expect(parseForm(startTrialFormSchema, form({ kind: "CLASS" })).success).toBe(true);
    expect(parseForm(startTrialFormSchema, form({ kind: "gym" })).success).toBe(false);
  });
});

describe("freezeRequestFormSchema", () => {
  const request = (firstDay: string, lastDay: string) => parseForm(freezeRequestFormSchema, form({ membershipId: ID, firstDay, lastDay }));

  it("parses the dates into local calendar days", () => {
    expect(request("2026-12-04", "2026-12-10")).toEqual({
      success: true,
      data: { membershipId: ID, firstDay: { year: 2026, month: 12, day: 4 }, lastDay: { year: 2026, month: 12, day: 10 } },
    });
  });

  it("accepts a single day and exactly 30 days", () => {
    expect(request("2026-12-04", "2026-12-04").success).toBe(true);
    expect(request("2026-12-04", "2027-01-02").success).toBe(true);
  });

  it("rejects 31 days on the last day", () => {
    expect(request("2026-12-04", "2027-01-03")).toEqual({ success: false, fieldErrors: { lastDay: "A freeze lasts at most 30 days" } });
  });

  it("rejects a last day before the first day", () => {
    expect(request("2026-12-10", "2026-12-04")).toEqual({
      success: false,
      fieldErrors: { lastDay: "The last day can't be before the first day" },
    });
  });

  it("asks for missing and invalid dates per field", () => {
    expect(request("", "2026-02-30")).toEqual({
      success: false,
      fieldErrors: { firstDay: "Enter a date", lastDay: "Enter a valid date" },
    });
    expect(parseForm(freezeRequestFormSchema, form({ membershipId: ID })).success).toBe(false);
  });

  it("counts calendar days across a leap day", () => {
    expect(localDaysBetween({ year: 2028, month: 2, day: 28 }, { year: 2028, month: 3, day: 1 })).toBe(2);
    expect(localDaysBetween({ year: 2027, month: 2, day: 28 }, { year: 2027, month: 3, day: 1 })).toBe(1);
  });
});

describe("inviteFormSchema", () => {
  it("normalizes the email and reports a bad one on the field", () => {
    expect(parseForm(inviteFormSchema, form({ membershipId: ID, email: " Partner@Example.TEST " }))).toEqual({
      success: true,
      data: { membershipId: ID, email: "partner@example.test" },
    });
    expect(parseForm(inviteFormSchema, form({ membershipId: ID, email: "partner" }))).toEqual({
      success: false,
      fieldErrors: { email: "Enter a valid email address" },
    });
  });
});

describe("recordPaymentFormSchema", () => {
  const base = { userId: "user-1", planId: ID, method: "CASH" };

  it("turns blank reference and note into null and confirmSwitch off", () => {
    expect(parseForm(recordPaymentFormSchema, form({ ...base, reference: " ", note: "" }))).toEqual({
      success: true,
      data: { ...base, reference: null, note: null, confirmSwitch: false },
    });
  });

  it("sets confirmSwitch only for the value the dialog sends", () => {
    const confirmed = parseForm(recordPaymentFormSchema, form({ ...base, confirmSwitch: "true" }));
    expect(confirmed.success && confirmed.data.confirmSwitch).toBe(true);
    expect(parseForm(recordPaymentFormSchema, form({ ...base, confirmSwitch: "yes" })).success).toBe(false);
  });

  it("refuses Stripe and unknown methods", () => {
    for (const method of ["STRIPE", "CHEQUE", ""]) {
      const parsed = parseForm(recordPaymentFormSchema, form({ ...base, method }));
      expect(parsed).toEqual({ success: false, fieldErrors: { method: "Choose a payment method" } });
    }
  });

  it("asks for a plan", () => {
    expect(parseForm(recordPaymentFormSchema, form({ ...base, planId: "" }))).toEqual({
      success: false,
      fieldErrors: { planId: "Choose a plan" },
    });
  });

  it("refuses personal data in the note and a multi-line reference", () => {
    const parsed = parseForm(recordPaymentFormSchema, form({ ...base, note: "paid by ann@example.test", reference: "A\nB" }));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(Object.keys(parsed.fieldErrors).sort()).toEqual(["note", "reference"]);
  });
});

describe("extendFormSchema", () => {
  it("parses the extension fields", () => {
    expect(parseForm(extendFormSchema, form({ membershipId: ID, method: "WHISH", reference: "W-1", note: "Second month" }))).toEqual({
      success: true,
      data: { membershipId: ID, method: "WHISH", reference: "W-1", note: "Second month" },
    });
  });
});

describe("refundFormSchema", () => {
  const refund = (amount: string, limit?: { amountCents: number; fullAllowed: boolean }) =>
    parseForm(refundFormSchema("usd", limit), form({ paymentId: ID, amount, reason: "Charged twice" }));

  it("turns the amount in currency units into cents", () => {
    expect(refund("12.50")).toEqual({ success: true, data: { paymentId: ID, amountCents: 1250, reason: "Charged twice" } });
    expect(refund(" 12.5 ")).toMatchObject({ success: true, data: { amountCents: 1250 } });
  });

  it.each(["abc", "12.505", "-5", "1,000", "12."])("rejects the malformed amount %j on the field", (amount) => {
    expect(refund(amount)).toEqual({ success: false, fieldErrors: { amount: "Enter an amount like 12.50" } });
  });

  it("asks for an amount above zero", () => {
    expect(refund("")).toEqual({ success: false, fieldErrors: { amount: "Enter an amount" } });
    expect(refund("0.00")).toEqual({ success: false, fieldErrors: { amount: "Enter an amount greater than 0" } });
  });

  it("allows up to the full amount when a full refund is allowed", () => {
    const limit = { amountCents: 3000, fullAllowed: true };
    expect(refund("30.00", limit).success).toBe(true);
    expect(refund("30.01", limit)).toEqual({ success: false, fieldErrors: { amount: "Enter at most US$30.00" } });
  });

  it("requires less than the full amount otherwise", () => {
    const limit = { amountCents: 3000, fullAllowed: false };
    expect(refund("29.99", limit).success).toBe(true);
    expect(refund("30", limit)).toEqual({ success: false, fieldErrors: { amount: "Enter less than US$30.00" } });
  });

  it("leaves the upper bound to the service without a limit", () => {
    expect(refund("99999.99").success).toBe(true);
  });

  it("requires a reason", () => {
    const parsed = parseForm(refundFormSchema("usd"), form({ paymentId: ID, amount: "1" }));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(Object.keys(parsed.fieldErrors)).toEqual(["reason"]);
  });
});

describe("rejectFreezeFormSchema", () => {
  it("stores a trimmed reason or null for a blank one", () => {
    expect(parseForm(rejectFreezeFormSchema, form({ freezeId: ID, reason: "  Dates overlap a holiday  " }))).toEqual({
      success: true,
      data: { freezeId: ID, reason: "Dates overlap a holiday" },
    });
    expect(parseForm(rejectFreezeFormSchema, form({ freezeId: ID, reason: "   " }))).toEqual({
      success: true,
      data: { freezeId: ID, reason: null },
    });
    expect(parseForm(rejectFreezeFormSchema, form({ freezeId: ID }))).toEqual({ success: true, data: { freezeId: ID, reason: null } });
  });
});
