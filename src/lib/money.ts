const LOCALE = "en-GB";
const MAX_INTEGER_DIGITS = 12;

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string): Intl.NumberFormat {
  const code = currency.toUpperCase();
  let cached = formatters.get(code);
  if (!cached) {
    cached = new Intl.NumberFormat(LOCALE, { style: "currency", currency: code });
    formatters.set(code, cached);
  }
  return cached;
}

/** Digits after the decimal point in the currency's minor unit (2 for USD, 0 for JPY). */
export function minorUnitDigits(currency: string): number {
  return formatter(currency).resolvedOptions().maximumFractionDigits ?? 2;
}

function assertMinorUnits(cents: number): void {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Amount must be an integer number of minor units, got ${cents}`);
}

/** Display formatting of an amount stored in minor units ("cents"), e.g. 1250 USD → "US$12.50". */
export function formatMoney(cents: number, currency: string): string {
  assertMinorUnits(cents);
  return formatter(currency).format(cents / 10 ** minorUnitDigits(currency));
}

/** An amount in minor units as an input value in currency units, without symbol or grouping: 1250 → "12.50". */
export function centsToAmountInput(cents: number, currency: string): string {
  assertMinorUnits(cents);
  if (cents < 0) throw new RangeError("Amount input can't be negative");
  const digits = minorUnitDigits(currency);
  if (digits === 0) return String(cents);
  const padded = String(cents).padStart(digits + 1, "0");
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

/**
 * Parses an amount typed in currency units ("12", "12.5", "12.50") into integer minor units.
 * Strict: digits with an optional decimal point and at most the currency's minor-unit digits
 * (2 for USD); no sign, grouping, symbols, or exponent. Returns null when the text doesn't match.
 */
export function parseAmountToCents(value: string, currency: string): number | null {
  const digits = minorUnitDigits(currency);
  const fraction = digits > 0 ? `(?:\\.(\\d{1,${digits}}))?` : "";
  const match = new RegExp(`^(\\d{1,${MAX_INTEGER_DIGITS}})${fraction}$`).exec(value.trim());
  if (!match) return null;
  const [, whole, part = ""] = match;
  return Number(whole) * 10 ** digits + Number(part.padEnd(digits, "0") || "0");
}
