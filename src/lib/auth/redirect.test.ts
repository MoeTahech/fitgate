import { describe, expect, it } from "vitest";
import { authPageHref, prefillEmail, safeRedirectPath } from "./redirect";

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

describe("prefillEmail", () => {
  it("returns a valid address, trimmed and lowercased", () => {
    expect(prefillEmail("  Pat.Partner@Example.test ")).toBe("pat.partner@example.test");
  });

  it.each([[null], [undefined], [""], ["not-an-email"], ["a@b"], [`${"a".repeat(300)}@example.test`]])("ignores %j", (input) => {
    expect(prefillEmail(input)).toBeUndefined();
  });
});

describe("authPageHref", () => {
  it("returns to `next` without an email", () => {
    expect(authPageHref("/sign-in", "/invite/membership/abc")).toBe("/sign-in?next=%2Finvite%2Fmembership%2Fabc");
  });

  it("adds the email for prefilling", () => {
    const href = authPageHref("/sign-up", "/invite/membership/abc", "pat@example.test");
    const url = new URL(href, "http://fitgate.invalid");
    expect(url.pathname).toBe("/sign-up");
    expect(url.searchParams.get("next")).toBe("/invite/membership/abc");
    expect(url.searchParams.get("email")).toBe("pat@example.test");
  });

  it("encodes characters that would end the value", () => {
    const url = new URL(authPageHref("/sign-in", "/x", "a+b&c=d@example.test"), "http://fitgate.invalid");
    expect(url.searchParams.get("email")).toBe("a+b&c=d@example.test");
  });
});
