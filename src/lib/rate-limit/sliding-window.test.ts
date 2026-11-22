import { describe, expect, it } from "vitest";
import { msUntilAvailable, weightedCount, windowPosition } from "./sliding-window";

function allowedAfter(
  previous: number,
  current: number,
  limit: number,
  elapsed: number,
  windowMs: number,
  waitMs: number,
): boolean {
  const position = elapsed + waitMs;
  if (position < windowMs) return weightedCount(previous, current, position, windowMs) < limit;
  if (position < 2 * windowMs) return weightedCount(current, 0, position - windowMs, windowMs) < limit;
  return true;
}

describe("sliding window", () => {
  it("locates the bucket and offset", () => {
    expect(windowPosition(125_000, 60_000)).toEqual({ bucket: 2, elapsed: 5_000 });
  });

  it("weights the previous bucket by its remaining overlap", () => {
    expect(weightedCount(10, 2, 0, 60_000)).toBe(12);
    expect(weightedCount(10, 2, 30_000, 60_000)).toBe(7);
    expect(weightedCount(10, 2, 59_999, 60_000)).toBe(2);
  });

  it("returns the exact wait until a request is allowed again", () => {
    const windowMs = 1_000;
    for (let limit = 1; limit <= 5; limit++) {
      for (let previous = 0; previous <= 8; previous++) {
        for (let current = 0; current <= 8; current++) {
          for (let elapsed = 0; elapsed < windowMs; elapsed += 37) {
            if (weightedCount(previous, current, elapsed, windowMs) < limit) continue;
            const wait = msUntilAvailable(previous, current, limit, elapsed, windowMs);
            expect(wait).toBeGreaterThan(0);
            expect(allowedAfter(previous, current, limit, elapsed, windowMs, wait)).toBe(true);
            expect(allowedAfter(previous, current, limit, elapsed, windowMs, wait - 1)).toBe(false);
          }
        }
      }
    }
  });
});
