import { Redis } from "@upstash/redis";
import { weightedCount, windowPosition } from "./sliding-window";

export type CounterResult = { allowed: boolean; previous: number; current: number };

/** Atomically checks the weighted count for `key` and, if under `limit`, records one request. */
export interface CounterStore {
  consume(key: string, rule: { limit: number; windowMs: number }, nowMs: number): Promise<CounterResult>;
}

const SLIDING_WINDOW_SCRIPT = `
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local elapsed = tonumber(ARGV[3])
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local previous = tonumber(redis.call("GET", KEYS[2]) or "0")
if math.floor(previous * (window - elapsed) / window) + current >= limit then
  return {0, previous, current}
end
current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], window * 2)
end
return {1, previous, current}
`;

export function createRedisClient(options: { url: string; token: string; timeoutMs: number }): Redis {
  return new Redis({
    url: options.url,
    token: options.token,
    retry: false,
    enableAutoPipelining: false,
    signal: () => AbortSignal.timeout(options.timeoutMs),
  });
}

export function createRedisStore(redis: Redis): CounterStore {
  const script = redis.createScript<[number, number, number]>(SLIDING_WINDOW_SCRIPT);

  return {
    async consume(key, { limit, windowMs }, nowMs) {
      const { bucket, elapsed } = windowPosition(nowMs, windowMs);
      const [allowed, previous, current] = await script.exec(
        [`${key}:${bucket}`, `${key}:${bucket - 1}`],
        [String(limit), String(windowMs), String(elapsed)],
      );
      return { allowed: allowed === 1, previous, current };
    },
  };
}

type MemoryEntry = { bucket: number; previous: number; current: number; expiresAt: number };

/** Per-instance fallback with the same algorithm. Bounded: expired entries are pruned, then the least recently used are evicted. */
export function createMemoryStore(options: { maxKeys?: number } = {}): CounterStore {
  const maxKeys = options.maxKeys ?? 10_000;
  const entries = new Map<string, MemoryEntry>();

  function makeRoom(nowMs: number) {
    if (entries.size < maxKeys) return;
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= nowMs) entries.delete(key);
    }
    for (const key of entries.keys()) {
      if (entries.size < maxKeys) break;
      entries.delete(key);
    }
  }

  return {
    async consume(key, { limit, windowMs }, nowMs) {
      const { bucket, elapsed } = windowPosition(nowMs, windowMs);
      const stored = entries.get(key);
      let previous = 0;
      let current = 0;
      if (stored?.bucket === bucket) {
        ({ previous, current } = stored);
      } else if (stored?.bucket === bucket - 1) {
        previous = stored.current;
      }

      const allowed = weightedCount(previous, current, elapsed, windowMs) < limit;
      if (allowed) current += 1;

      entries.delete(key);
      if (current > 0 || previous > 0) {
        makeRoom(nowMs);
        entries.set(key, { bucket, previous, current, expiresAt: (bucket + 2) * windowMs });
      }
      return { allowed, previous, current };
    },
  };
}
