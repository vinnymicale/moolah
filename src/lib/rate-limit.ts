// Fixed-window in-memory rate limiter.
//
// Self-host runs a single Node process, so this is fully effective there. On
// serverless it bounds abuse per warm instance - not a global guarantee, but
// enough to stop a runaway client or brute-force loop without adding an
// external store. Swap for a Redis-backed limiter if this ever runs
// multi-instance with real users.

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (only meaningful when blocked). */
  retryAfterSec: number;
}

/**
 * Count a hit against `key` and report whether it stays within `max` per
 * `windowMs`. Keys should include the scope, e.g. `chat:<userId>`.
 */
export function checkRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  w.count++;
  if (w.count > max) {
    return { allowed: false, retryAfterSec: Math.ceil((w.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

// Periodically drop expired windows so long-lived processes don't accumulate
// stale keys. unref() keeps the timer from holding the process open.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, w] of windows) {
    if (now >= w.resetAt) windows.delete(key);
  }
}, 60_000);
sweeper.unref?.();
