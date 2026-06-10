import { describe, it, expect, vi, afterEach } from "vitest";
import { checkRateLimit } from "./rate-limit";

afterEach(() => {
  vi.useRealTimers();
});

// Unique key per test so the shared module-level map never bleeds state.
let n = 0;
const freshKey = () => `test:${++n}:${Date.now()}`;

describe("checkRateLimit", () => {
  it("allows up to max hits in a window", () => {
    const key = freshKey();
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000).allowed).toBe(true);
    }
  });

  it("blocks the hit after max and reports retry time", () => {
    const key = freshKey();
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 60_000);
    const result = checkRateLimit(key, 3, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
    expect(result.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    const key = freshKey();
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 60_000);
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const a = freshKey();
    const b = freshKey();
    for (let i = 0; i < 3; i++) checkRateLimit(a, 3, 60_000);
    expect(checkRateLimit(a, 3, 60_000).allowed).toBe(false);
    expect(checkRateLimit(b, 3, 60_000).allowed).toBe(true);
  });
});
