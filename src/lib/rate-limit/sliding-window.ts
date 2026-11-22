/**
 * Sliding-window counter: two fixed buckets per key, with the previous bucket's
 * count weighted by how much of it still overlaps the window ending now.
 * The Redis Lua script mirrors `weightedCount` exactly.
 */

export type RateLimitRule = { limit: number; windowSeconds: number };

export type RateLimitDecision = {
  success: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function windowPosition(nowMs: number, windowMs: number): { bucket: number; elapsed: number } {
  const bucket = Math.floor(nowMs / windowMs);
  return { bucket, elapsed: nowMs - bucket * windowMs };
}

export function weightedCount(previous: number, current: number, elapsed: number, windowMs: number): number {
  return Math.floor((previous * (windowMs - elapsed)) / windowMs) + current;
}

/** Milliseconds until a request would be allowed again, assuming no further requests arrive. */
export function msUntilAvailable(
  previous: number,
  current: number,
  limit: number,
  elapsed: number,
  windowMs: number,
): number {
  if (current < limit) {
    // Wait for the previous bucket's weight to decay below the remaining headroom.
    const target = Math.floor(windowMs - ((limit - current) * windowMs) / previous) + 1;
    return Math.max(1, Math.min(target, windowMs) - elapsed);
  }
  // The current bucket alone is full: wait for it to become the (decaying) previous bucket.
  const intoNext = Math.floor(windowMs - (limit * windowMs) / current) + 1;
  return windowMs - elapsed + intoNext;
}
