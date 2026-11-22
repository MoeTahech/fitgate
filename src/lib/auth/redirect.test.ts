import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/account", "/account"],
    ["/admin/users?q=sam#top", "/admin/users?q=sam#top"],
    ["/invite/trainer/abc", "/invite/trainer/abc"],
    ["/a/../b", "/b"],
  ])("keeps relative path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["account"],
    ["https://evil.example"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["\\\\evil.example"],
    ["/%0d%0aSet-Cookie:x".replace("%0d%0a", "\r\n")],
    ["javascript:alert(1)"],
    [`/${"a".repeat(3000)}`],
  ])("rejects %j", (input) => {
    expect(safeRedirectPath(input)).toBe("/");
  });

  it("uses the given fallback", () => {
    expect(safeRedirectPath("https://evil.example", "/account")).toBe("/account");
  });
});
