import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const SECRET = "s".repeat(32);

const valid = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://user:pass@localhost:5433/fitgate",
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: "http://localhost:3000",
  HASH_SECRET: SECRET,
  UPSTASH_REDIS_REST_URL: "http://localhost:8079",
  UPSTASH_REDIS_REST_TOKEN: "token",
  EMAIL_TRANSPORT: "smtp",
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  EMAIL_FROM: "FitGate <no-reply@fitgate.local>",
};

function omit(source: Record<string, string>, ...keys: string[]) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
}

describe("parseEnv", () => {
  it("parses a valid environment and coerces types", () => {
    const env = parseEnv({ ...valid, BETTER_AUTH_URL: "http://localhost:3000/" });
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(env.EMAIL_TRANSPORT === "smtp" && env.SMTP_PORT).toBe(1025);
  });

  it("does not require SMTP settings for the console transport", () => {
    expect(parseEnv({ ...omit(valid, "SMTP_HOST", "SMTP_PORT"), EMAIL_TRANSPORT: "console" }).EMAIL_TRANSPORT).toBe("console");
  });

  it("names missing and invalid variables without echoing secret values", () => {
    const leaked = "short-secret-value";
    let message = "";
    try {
      parseEnv({ ...omit(valid, "HASH_SECRET"), BETTER_AUTH_SECRET: leaked });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("HASH_SECRET");
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).not.toContain(leaked);
  });

  it("requires SMTP settings for the smtp transport", () => {
    expect(() => parseEnv(omit(valid, "SMTP_HOST"))).toThrow(/SMTP_HOST/);
  });

  it("rejects the console transport and plain http in production", () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: "production", BETTER_AUTH_URL: "https://fitgate.app", EMAIL_TRANSPORT: "console" })).toThrow(
      /EMAIL_TRANSPORT/,
    );
    expect(() => parseEnv({ ...valid, NODE_ENV: "production", BETTER_AUTH_URL: "http://fitgate.app" })).toThrow(
      /BETTER_AUTH_URL/,
    );
    expect(parseEnv({ ...valid, NODE_ENV: "production" }).BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(parseEnv({ ...valid, NODE_ENV: "production", BETTER_AUTH_URL: "https://fitgate.app" }).NODE_ENV).toBe(
      "production",
    );
  });
});
