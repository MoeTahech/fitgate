import { describe, expect, it } from "vitest";
import { centsToAmountInput, formatMoney, minorUnitDigits, parseAmountToCents } from "./money";

describe("formatMoney", () => {
  it("formats minor units in the currency, case-insensitively", () => {
    expect(formatMoney(1250, "usd")).toBe("US$12.50");
    expect(formatMoney(1250, "USD")).toBe("US$12.50");
    expect(formatMoney(0, "usd")).toBe("US$0.00");
    expect(formatMoney(123456789, "usd")).toBe("US$1,234,567.89");
  });

  it("uses the currency's minor unit", () => {
    expect(formatMoney(1250, "eur")).toBe("€12.50");
    expect(formatMoney(1250, "jpy")).toBe("JP¥1,250");
  });

  it("rejects amounts that aren't whole minor units", () => {
    expect(() => formatMoney(12.5, "usd")).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN, "usd")).toThrow(RangeError);
  });
});

describe("minorUnitDigits", () => {
  it.each([
    ["usd", 2],
    ["jpy", 0],
    ["kwd", 3],
  ])("%s has %d digits", (currency, digits) => {
    expect(minorUnitDigits(currency)).toBe(digits);
  });
});

describe("centsToAmountInput", () => {
  it.each([
    [1250, "12.50"],
    [5, "0.05"],
    [0, "0.00"],
    [100000, "1000.00"],
  ])("%d → %s", (cents, text) => {
    expect(centsToAmountInput(cents, "usd")).toBe(text);
  });

  it("has no decimals for zero-decimal currencies", () => {
    expect(centsToAmountInput(1250, "jpy")).toBe("1250");
  });

  it("round-trips through parseAmountToCents", () => {
    for (const cents of [1, 9, 10, 99, 100, 1250, 999999]) {
      expect(parseAmountToCents(centsToAmountInput(cents, "usd"), "usd")).toBe(cents);
    }
  });

  it("rejects negative or fractional amounts", () => {
    expect(() => centsToAmountInput(-1, "usd")).toThrow(RangeError);
    expect(() => centsToAmountInput(1.5, "usd")).toThrow(RangeError);
  });
});

describe("parseAmountToCents", () => {
  it.each([
    ["12.50", 1250],
    ["12.5", 1250],
    ["12", 1200],
    ["0.01", 1],
    ["0", 0],
    ["007.10", 710],
    ["  12.50  ", 1250],
    ["999999999999.99", 99999999999999],
  ])("%j → %d", (text, cents) => {
    expect(parseAmountToCents(text, "usd")).toBe(cents);
  });

  it("avoids floating-point rounding", () => {
    expect(parseAmountToCents("0.29", "usd")).toBe(29);
    expect(parseAmountToCents("19.99", "usd")).toBe(1999);
    expect(parseAmountToCents("1.005", "usd")).toBeNull();
  });

  it.each([
    "",
    " ",
    "12.505",
    "12.",
    ".5",
    "-1",
    "+1",
    "1,000",
    "1 000",
    "$12",
    "12 USD",
    "1e3",
    "0x10",
    "Infinity",
    "NaN",
    "12.5.0",
    "١٢",
    "1000000000000",
  ])("rejects %j", (text) => {
    expect(parseAmountToCents(text, "usd")).toBeNull();
  });

  it("follows the currency's minor unit", () => {
    expect(parseAmountToCents("1250", "jpy")).toBe(1250);
    expect(parseAmountToCents("12.5", "jpy")).toBeNull();
    expect(parseAmountToCents("1.250", "kwd")).toBe(1250);
  });
});
