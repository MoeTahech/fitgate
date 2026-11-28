import { afterEach, describe, expect, it, vi } from "vitest";
import { keyedHash } from "@/lib/crypto";
import { getRequestIp, getRequestIpHash } from "./request-ip";

const request = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock("next/headers", () => ({ headers: async () => request.headers }));

afterEach(() => {
  request.headers = new Headers();
});

function forwardedFor(value: string) {
  request.headers = new Headers({ "x-forwarded-for": value });
}

describe("getRequestIp", () => {
  it("returns the first x-forwarded-for address, trimmed", async () => {
    forwardedFor(" 203.0.113.7 , 10.0.0.1, 10.0.0.2");
    await expect(getRequestIp()).resolves.toBe("203.0.113.7");
  });

  it("returns a single IPv6 address", async () => {
    forwardedFor("2001:db8::1");
    await expect(getRequestIp()).resolves.toBe("2001:db8::1");
  });

  it("returns null without the header or with a blank first entry", async () => {
    await expect(getRequestIp()).resolves.toBeNull();
    forwardedFor(" , 10.0.0.1");
    await expect(getRequestIp()).resolves.toBeNull();
  });
});

describe("getRequestIpHash", () => {
  it("hashes the address getRequestIp returns", async () => {
    forwardedFor("203.0.113.7, 10.0.0.1");
    await expect(getRequestIpHash()).resolves.toBe(keyedHash("ip", "203.0.113.7"));
  });

  it("returns null without an address", async () => {
    await expect(getRequestIpHash()).resolves.toBeNull();
  });
});
