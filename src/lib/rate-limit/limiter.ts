import type { CounterStore } from "./stores";
import {
  msUntilAvailable,
  weightedCount,
  windowPosition,
  type RateLimitDecision,
  type RateLimitRule,
} from "./sliding-window";

export type RateLimiterOptions = {
  primary: CounterStore;
  fallback: CounterStore;
  /** Key namespace, e.g. `rl`. Keys are `{prefix}:{policy}:{hash(identifier)}:{bucket}`. */
  prefix: string;
  /** One-way keyed hash so raw identifiers (emails, IPs) never reach the store. */
  hash: (identifier: string) => string;
  now?: () => number;
  logger?: Pick<Console, "error">;
  /** Minimum interval between "primary store unavailable" log lines. */
  logIntervalMs?: number;
  maxBlockedKeys?: number;
};

export type RateLimiter = {
  consume(policy: string, identifier: string, rule: RateLimitRule): Promise<RateLimitDecision>;
};

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const logger = options.logger ?? console;
  const logIntervalMs = options.logIntervalMs ?? 60_000;
  const maxBlockedKeys = options.maxBlockedKeys ?? 10_000;
  const blockedUntil = new Map<string, number>();
  let lastFailureLog = Number.NEGATIVE_INFINITY;

  function reportFailure(error: unknown, at: number) {
    if (at - lastFailureLog < logIntervalMs) return;
    lastFailureLog = at;
    const detail = error instanceof Error ? { name: error.name, message: error.message } : { error: String(error) };
    logger.error("[rate-limit] primary store unavailable; using in-memory fallback", detail);
  }

  function rememberBlocked(key: string, until: number, at: number) {
    if (blockedUntil.size >= maxBlockedKeys) {
      for (const [blockedKey, expiry] of blockedUntil) {
        if (expiry <= at) blockedUntil.delete(blockedKey);
      }
      for (const blockedKey of blockedUntil.keys()) {
        if (blockedUntil.size < maxBlockedKeys) break;
        blockedUntil.delete(blockedKey);
      }
    }
    blockedUntil.set(key, until);
  }

  function denied(retryMs: number): RateLimitDecision {
    return { success: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
  }

  return {
    async consume(policy, identifier, rule) {
      const at = now();
      const key = `${options.prefix}:${policy}:${options.hash(identifier)}`;

      const cachedUntil = blockedUntil.get(key);
      if (cachedUntil !== undefined) {
        if (cachedUntil > at) return denied(cachedUntil - at);
        blockedUntil.delete(key);
      }

      const windowMs = rule.windowSeconds * 1000;
      const counterRule = { limit: rule.limit, windowMs };
      let result;
      try {
        result = await options.primary.consume(key, counterRule, at);
      } catch (error) {
        reportFailure(error, at);
        result = await options.fallback.consume(key, counterRule, at);
      }

      const { elapsed } = windowPosition(at, windowMs);
      if (result.allowed) {
        const used = weightedCount(result.previous, result.current, elapsed, windowMs);
        return { success: true, remaining: Math.max(0, rule.limit - used), retryAfterSeconds: 0 };
      }

      const retryMs = msUntilAvailable(result.previous, result.current, rule.limit, elapsed, windowMs);
      rememberBlocked(key, at + retryMs, at);
      return denied(retryMs);
    },
  };
}
