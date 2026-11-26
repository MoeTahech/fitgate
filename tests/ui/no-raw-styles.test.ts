import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SCANNED = ["src/app", "src/components"];
const EXCLUDED = join("src", "components", "ui") + sep;

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITY = "bg|text|border|ring|outline|fill|stroke|from|via|to|divide|placeholder|decoration|shadow|accent|caret";

const RULES: { name: string; pattern: RegExp }[] = [
  { name: "dark: variant", pattern: /(?<![\w-])dark:/ },
  { name: "palette color", pattern: new RegExp(`(?<![\\w-])(?:${UTILITY})-(?:${PALETTE})-\\d{2,3}\\b`) },
  { name: "black/white color", pattern: new RegExp(`(?<![\\w-])(?:${UTILITY})-(?:black|white)\\b`) },
  { name: "arbitrary color", pattern: /(?<![\w-])(?:bg|text|border|ring|outline|fill|stroke)-\[(?:#|rgb|hsl|oklch)/ },
  { name: "Table primitive (use DataTable)", pattern: /from\s+["']@\/components\/ui\/table["']/ },
];

function violations(source: string): string[] {
  return source.split("\n").flatMap((line, index) =>
    RULES.filter((rule) => rule.pattern.test(line)).map((rule) => `${index + 1}: ${rule.name}: ${line.trim()}`),
  );
}

function scannedFiles(): string[] {
  return SCANNED.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => join(dir, file))
      .filter((file) => !file.startsWith(EXCLUDED)),
  );
}

describe("app code styles only through tokens and shared components", () => {
  it("scans the app and component folders", () => {
    expect(scannedFiles().length).toBeGreaterThan(10);
  });

  it.each(scannedFiles())("%s", (file) => {
    expect(violations(readFileSync(join(ROOT, file), "utf8"))).toEqual([]);
  });
});

describe("violations", () => {
  it.each([
    'className="bg-zinc-900 text-white"',
    'className="hover:text-red-700"',
    'className="dark:bg-black"',
    'className="border-emerald-200"',
    'className="text-[#ff0000]"',
    'import { Table, TableRow } from "@/components/ui/table";',
  ])("flags %s", (line) => {
    expect(violations(line)).not.toEqual([]);
  });

  it.each([
    'className="bg-primary text-primary-foreground"',
    'className="text-status-past-due-foreground"',
    'className="border-header-border hover:bg-header-foreground/10"',
    'className="text-muted-foreground"',
    "const darkMode = false;",
  ])("allows %s", (line) => {
    expect(violations(line)).toEqual([]);
  });
});
