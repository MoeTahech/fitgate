import { describe, expect, it } from "vitest";
import { generateToken, keyedHash, sha256 } from "./crypto";

describe("generateToken", () => {
  it("returns 32 random bytes as base64url by default", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(generateToken()).not.toBe(token);
  });
});

describe("sha256", () => {
  it("returns the hex digest", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("keyedHash", () => {
  const secret = "k".repeat(32);

  it("is deterministic per purpose and secret", () => {
    expect(keyedHash("ip", "203.0.113.7", secret)).toBe(keyedHash("ip", "203.0.113.7", secret));
    expect(keyedHash("ip", "203.0.113.7", secret)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates purposes and secrets", () => {
    const value = "someone@example.test";
    expect(keyedHash("trial", value, secret)).not.toBe(keyedHash("rate-limit", value, secret));
    expect(keyedHash("trial", value, secret)).not.toBe(keyedHash("trial", value, "x".repeat(32)));
  });

  it("does not contain the input", () => {
    expect(keyedHash("rate-limit", "someone@example.test", secret)).not.toContain("someone");
  });
});
