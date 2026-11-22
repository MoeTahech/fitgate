import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl } from "./test-database-url";

describe("assertTestDatabaseUrl", () => {
  it("accepts a PostgreSQL URL whose database name ends in _test", () => {
    const url = "postgresql://user:pass@localhost:5433/fitgate_test";
    expect(assertTestDatabaseUrl(url)).toBe(url);
    expect(assertTestDatabaseUrl("postgres://localhost/app_test?schema=public")).toBe(
      "postgres://localhost/app_test?schema=public",
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["invalid", "not a url"],
    ["non-postgres", "mysql://localhost/fitgate_test"],
    ["no database name", "postgresql://localhost:5433/"],
    ["development database", "postgresql://localhost:5433/fitgate"],
    ["suffix only", "postgresql://localhost:5433/_test"],
    ["suffix not at the end", "postgresql://localhost:5433/fitgate_test_copy"],
  ])("rejects a %s URL", (_label, url) => {
    expect(() => assertTestDatabaseUrl(url)).toThrow();
  });
});
