import { describe, expect, it } from "vitest";
import { firstInvalidControl } from "./field-errors";

const controls = [{ name: "name" }, { name: "email" }, { name: "" }, { name: "password" }];

describe("firstInvalidControl", () => {
  it("picks the first invalid control in document order, not error order", () => {
    expect(firstInvalidControl(controls, { password: "Too short", email: "Invalid" })).toBe(controls[1]);
  });

  it("skips controls without an error and unnamed controls", () => {
    expect(firstInvalidControl(controls, { password: "Too short" })).toBe(controls[3]);
  });

  it("returns null when only form-level errors exist", () => {
    expect(firstInvalidControl(controls, { form: "Passwords don't match" })).toBeNull();
    expect(firstInvalidControl(controls, {})).toBeNull();
  });

  it("ignores inherited keys", () => {
    expect(firstInvalidControl([{ name: "toString" }], {})).toBeNull();
  });
});
