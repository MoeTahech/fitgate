import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it, vi } from "vitest";
import { keyedHash } from "@/lib/crypto";
import { env } from "@/lib/env";
import { createBetterAuthStorage } from "./index";
import { createRateLimiter } from "./limiter";
import { createMemoryStore, createRedisClient, createRedisStore, type CounterStore } from "./stores";

const WINDOW_MS = 60_000;
const RULE = { limit: 3, windowSeconds: WINDOW_MS / 1000 };
const START = 1_000 * WINDOW_MS;

const redis = createRedisClient({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
  timeoutMs: 1000,
});
const prefix = `rl-test-${randomUUID()}`;
const hash = (identifier: string) => keyedHash("rate-limit", identifier);

afterAll(async () => {
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length > 0) await redis.del(...keys);
});

function fakeClock(start = START) {
  let time = start;
  return { now: () => time, advance: (ms: number) => void (time += ms) };
}

const unusedFallback: CounterStore = {
  consume: () => Promise.reject(new Error("fallback must not be used")),
};

function countingStore(store: CounterStore) {
  const consume = vi.fn(store.consume);
  return { store: { consume } satisfies CounterStore, consume };
}

async function consumeMany(limiter: ReturnType<typeof createRateLimiter>, count: number, identifier = "id") {
  const results = [];
  for (let i = 0; i < count; i++) results.push(await limiter.consume("policy", identifier, RULE));
  return results;
}

describe.each([
  ["redis", () => createRedisStore(redis)],
  ["memory", () => createMemoryStore()],
])("rate limiter with %s store", (_name, makeStore) => {
  function setup() {
    const clock = fakeClock();
    const limiter = createRateLimiter({
      primary: makeStore(),
      fallback: unusedFallback,
      prefix: `${prefix}:${randomUUID()}`,
      hash,
      now: clock.now,
    });
    return { clock, limiter };
  }

  it("allows up to the limit, then blocks with a retry time", async () => {
    const { limiter } = setup();
    const results = await consumeMany(limiter, 4);
    expect(results.map((r) => r.success)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3].retryAfterSeconds).toBe(61);
  });

  it("frees capacity as the window slides", async () => {
    const { clock, limiter } = setup();
    await consumeMany(limiter, 3);
    clock.advance(WINDOW_MS + WINDOW_MS / 2);
    const results = await consumeMany(limiter, 3);
    expect(results.map((r) => r.success)).toEqual([true, true, false]);
  });

  it("resets once a full window has passed", async () => {
    const { clock, limiter } = setup();
    await consumeMany(limiter, 4);
    clock.advance(2 * WINDOW_MS);
    expect((await consumeMany(limiter, 3)).every((r) => r.success)).toBe(true);
  });

  it("keeps identifiers and policies separate", async () => {
    const { limiter } = setup();
    await consumeMany(limiter, 3, "first");
    expect((await limiter.consume("policy", "second", RULE)).success).toBe(true);
    expect((await limiter.consume("other-policy", "first", RULE)).success).toBe(true);
    expect((await limiter.consume("policy", "first", RULE)).success).toBe(false);
  });
});

describe("rate limiter", () => {
  it("serves repeated blocked requests from the local cache until the retry time", async () => {
    const clock = fakeClock();
    const { store, consume } = countingStore(createMemoryStore());
    const limiter = createRateLimiter({ primary: store, fallback: unusedFallback, prefix: "p", hash, now: clock.now });

    await consumeMany(limiter, 4);
    expect(consume).toHaveBeenCalledTimes(4);
    await consumeMany(limiter, 5);
    expect(consume).toHaveBeenCalledTimes(4);

    clock.advance(61_000);
    expect((await limiter.consume("policy", "id", RULE)).success).toBe(true);
    expect(consume).toHaveBeenCalledTimes(5);
  });

  it("stores only hashed identifiers in Redis", async () => {
    const keyPrefix = `${prefix}:${randomUUID()}`;
    const limiter = createRateLimiter({
      primary: createRedisStore(redis),
      fallback: unusedFallback,
      prefix: keyPrefix,
      hash,
    });
    await limiter.consume("signIn", "203.0.113.7:someone@example.test", RULE);

    const keys = await redis.keys(`${keyPrefix}:*`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^${keyPrefix}:signIn:[0-9a-f]{64}:\\d+$`));
    expect(keys[0]).not.toContain("someone");
    expect(keys[0]).not.toContain("203.0.113.7");
  });

  it("falls back to memory and keeps enforcing limits when Redis is unreachable", async () => {
    const logger = { error: vi.fn() };
    const limiter = createRateLimiter({
      primary: createRedisStore(createRedisClient({ url: "http://127.0.0.1:9", token: "unused", timeoutMs: 500 })),
      fallback: createMemoryStore(),
      prefix: "p",
      hash,
      logger,
    });

    const results = await consumeMany(limiter, 4, "someone@example.test");
    expect(results.map((r) => r.success)).toEqual([true, true, true, false]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("someone");
  });

  describe("when Redis does not respond", () => {
    let server: Server;

    afterAll(() => {
      server.closeAllConnections();
      server.close();
    });

    it("times out and falls back", async () => {
      server = createServer(() => undefined);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;

      const limiter = createRateLimiter({
        primary: createRedisStore(createRedisClient({ url: `http://127.0.0.1:${port}`, token: "unused", timeoutMs: 200 })),
        fallback: createMemoryStore(),
        prefix: "p",
        hash,
        logger: { error: vi.fn() },
      });

      const started = performance.now();
      expect((await limiter.consume("policy", "id", RULE)).success).toBe(true);
      expect(performance.now() - started).toBeLessThan(2000);
    });
  });
});

describe("memory store", () => {
  it("evicts entries beyond its key cap", async () => {
    const store = createMemoryStore({ maxKeys: 2 });
    const rule = { limit: 1, windowMs: WINDOW_MS };
    expect((await store.consume("a", rule, START)).allowed).toBe(true);
    expect((await store.consume("b", rule, START)).allowed).toBe(true);
    expect((await store.consume("c", rule, START)).allowed).toBe(true);
    expect((await store.consume("a", rule, START)).allowed).toBe(true);
    expect((await store.consume("c", rule, START)).allowed).toBe(false);
  });
});

describe("Better Auth storage adapter", () => {
  it("maps decisions to Better Auth's consume contract", async () => {
    const limiter = createRateLimiter({ primary: createMemoryStore(), fallback: unusedFallback, prefix: "p", hash });
    const storage = createBetterAuthStorage(() => limiter);
    const key = "203.0.113.7|/sign-in/email";

    expect(await storage.consume(key, { window: 60, max: 2 })).toEqual({ allowed: true, retryAfter: null });
    expect(await storage.consume(key, { window: 60, max: 2 })).toEqual({ allowed: true, retryAfter: null });
    const blocked = await storage.consume(key, { window: 60, max: 2 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});
