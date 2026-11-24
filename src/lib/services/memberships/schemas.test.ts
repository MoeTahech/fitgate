import { describe, expect, it } from "vitest";
import { hasNoContactData, noteSchema, reasonSchema, referenceSchema } from "./schemas";

describe("hasNoContactData", () => {
  it.each([
    "Paid 30.00 in cash at the desk",
    "Second quarter, e.g. Apr-Jun",
    "Ref 12/2026 #4, i.e. the OMT slip",
    "Member asked to split @ the desk",
  ])("accepts %j", (text) => {
    expect(hasNoContactData(text)).toBe(true);
  });

  it.each([
    "Receipt sent to someone@example.com",
    "contact: first.last+gym@mail.example.lb",
    "See https://pay.example/r/1",
    "ftp://files.example/receipt",
    "Proof on www.example.org",
    "Uploaded to drive.google.com",
    "Check bit.ly/abc",
  ])("rejects %j", (text) => {
    expect(hasNoContactData(text)).toBe(false);
  });
});

describe("noteSchema", () => {
  it("trims, turns blank into null, and caps at 500 characters", () => {
    expect(noteSchema.parse("  Paid at the desk  ")).toBe("Paid at the desk");
    expect(noteSchema.parse("   ")).toBeNull();
    expect(noteSchema.parse(undefined)).toBeNull();
    expect(noteSchema.parse(null)).toBeNull();
    expect(noteSchema.parse(` ${"x".repeat(500)} `)).toHaveLength(500);
    expect(noteSchema.safeParse("x".repeat(501)).success).toBe(false);
  });

  it("rejects an email address or a URL", () => {
    expect(noteSchema.safeParse("Mail me at a@b.co").success).toBe(false);
    expect(noteSchema.safeParse("http://example.test").success).toBe(false);
  });
});

describe("reasonSchema", () => {
  it("requires text after trimming and rejects contact data", () => {
    expect(reasonSchema.parse("  Recorded twice ")).toBe("Recorded twice");
    expect(reasonSchema.safeParse("   ").success).toBe(false);
    expect(reasonSchema.safeParse("x".repeat(501)).success).toBe(false);
    expect(reasonSchema.safeParse("Asked via someone@example.com").success).toBe(false);
  });
});

describe("referenceSchema", () => {
  it("trims, turns blank into null, caps at 100 characters, and rejects line breaks", () => {
    expect(referenceSchema.parse("  WH-123 ")).toBe("WH-123");
    expect(referenceSchema.parse("")).toBeNull();
    expect(referenceSchema.parse(undefined)).toBeNull();
    expect(referenceSchema.safeParse("x".repeat(101)).success).toBe(false);
    expect(referenceSchema.safeParse("WH-1\nWH-2").success).toBe(false);
  });
});
