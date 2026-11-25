import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");

const TEXT = 4.5;
const NON_TEXT = 3;

/** [foreground token, background token, minimum ratio] */
const PAIRS: [string, string, number][] = [
  ["foreground", "background", TEXT],
  ["card-foreground", "card", TEXT],
  ["popover-foreground", "popover", TEXT],
  ["secondary-foreground", "secondary", TEXT],
  ["muted-foreground", "background", TEXT],
  ["muted-foreground", "muted", TEXT],
  ["muted-foreground", "card", TEXT],
  ["accent-foreground", "accent", TEXT],
  ["primary-foreground", "primary", TEXT],
  ["primary-foreground", "primary-hover", TEXT],
  ["link", "background", TEXT],
  ["link", "muted", TEXT],
  ["link", "card", TEXT],
  ["link-hover", "background", TEXT],
  ["destructive-foreground", "destructive", TEXT],
  ["destructive", "background", TEXT],
  ["destructive", "card", TEXT],
  ["destructive", "destructive-subtle", TEXT],
  ["success", "success-subtle", TEXT],
  ["warning", "warning-subtle", TEXT],
  ["info", "info-subtle", TEXT],
  ["header-foreground", "header", TEXT],
  ["header-muted", "header", TEXT],
  ["header-active", "header", TEXT],
  ...["active", "frozen", "past-due", "expired", "cancelled", "pending"].map(
    (status): [string, string, number] => [`status-${status}-foreground`, `status-${status}`, TEXT],
  ),
  ["ring", "background", NON_TEXT],
  ["ring", "card", NON_TEXT],
  ["ring", "header", NON_TEXT],
  ["input", "background", NON_TEXT],
  ["input", "card", NON_TEXT],
];

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`${selector} block not found in globals.css`);
  const body = css.slice(start, css.indexOf("}", start));
  return new Map([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each([":root", ".dark"])("%s tokens", (selector) => {
  const tokens = block(selector);

  it.each(PAIRS)("%s on %s meets %s:1", (fg, bg, min) => {
    const fgColor = tokens.get(fg);
    const bgColor = tokens.get(bg);
    expect(fgColor, `--${fg} missing`).toBeDefined();
    expect(bgColor, `--${bg} missing`).toBeDefined();
    expect(contrast(fgColor!, bgColor!)).toBeGreaterThanOrEqual(min);
  });

  it("defines the same tokens as :root", () => {
    expect([...tokens.keys()].sort()).toEqual([...block(":root").keys()].sort());
  });
});

describe("contrast", () => {
  it("matches the WCAG formula", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#c2410c", "#ffffff")).toBeCloseTo(5.18, 2);
  });
});
