import "server-only";
import type { BetterAuthRateLimitStorage } from "better-auth";
import { keyedHash } from "@/lib/crypto";
import { env } from "@/lib/env";
import { createRateLimiter, type RateLimiter } from "./limiter";
import type { RateLimitDecision, RateLimitRule } from "./sliding-window";
import { createMemoryStore, createRedisClient, createRedisStore } from "./stores";

export type { RateLimitDecision, RateLimitRule } from "./sliding-window";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Limits keyed by something other than the client IP alone (applied by app code). */
export const RATE_LIMIT_POLICIES = {
  /** Per IP + email. */
  signIn: { limit: 5, windowSeconds: 15 * MINUTE },
  /** Per email. */
  passwordResetRequest: { limit: 3, windowSeconds: HOUR },
  /** Per email. */
  verificationEmail: { limit: 3, windowSeconds: HOUR },
  /** Per user. */
  trialStartUser: { limit: 3, windowSeconds: DAY },
  /** Per IP. */
  trialStartIp: { limit: 10, windowSeconds: DAY },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitPolicy = keyof typeof RATE_LIMIT_POLICIES;

/** Per-IP limits enforced by Better Auth's limiter (`rateLimit.customRules`); `window` in seconds. */
export const AUTH_IP_RULES = {
  "/sign-in/email": { window: 15 * MINUTE, max: 20 },
  "/sign-up/email": { window: HOUR, max: 5 },
  "/request-password-reset": { window: HOUR, max: 10 },
  "/reset-password": { window: 15 * MINUTE, max: 10 },
} as const;

const REDIS_TIMEOUT_MS = 1000;

let limiter: RateLimiter | undefined;

function getLimiter(): RateLimiter {
  limiter ??= createRateLimiter({
    primary: createRedisStore(
      createRedisClient({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
        timeoutMs: REDIS_TIMEOUT_MS,
      }),
    ),
    fallback: createMemoryStore(),
    prefix: "rl",
    hash: (identifier) => keyedHash("rate-limit", identifier),
  });
  return limiter;
}

export function rateLimit(policy: RateLimitPolicy, identifier: string): Promise<RateLimitDecision> {
  return getLimiter().consume(policy, identifier, RATE_LIMIT_POLICIES[policy]);
}

export function createBetterAuthStorage(getRateLimiter: () => RateLimiter): BetterAuthRateLimitStorage {
  return {
    async consume(key, rule) {
      const decision = await getRateLimiter().consume("auth", key, {
        limit: rule.max,
        windowSeconds: rule.window,
      });
      return { allowed: decision.success, retryAfter: decision.success ? null : decision.retryAfterSeconds };
    },
  };
}

export const betterAuthRateLimitStorage: BetterAuthRateLimitStorage = createBetterAuthStorage(getLimiter);
