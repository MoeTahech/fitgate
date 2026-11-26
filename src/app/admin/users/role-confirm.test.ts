import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/auth/constants";
import { needsSelfDemotionConfirm, parseRole } from "./role-confirm";

describe("needsSelfDemotionConfirm", () => {
  it.each([
    [true, "MEMBER", true],
    [true, "TRAINER", true],
    [true, "ADMIN", false],
    [false, "MEMBER", false],
    [false, "TRAINER", false],
    [false, "ADMIN", false],
  ] as const)("isSelf=%s, selected=%s -> %s", (isSelf, selected, expected) => {
    expect(needsSelfDemotionConfirm({ isSelf, selected })).toBe(expected);
  });
});

describe("parseRole", () => {
  it.each(ROLES)("accepts %s", (role) => {
    expect(parseRole(role)).toBe(role);
  });

  it.each(["", "admin", "OWNER"])("rejects %j", (value) => {
    expect(parseRole(value)).toBeNull();
  });
});
