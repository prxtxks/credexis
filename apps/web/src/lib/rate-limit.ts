/**
 * API rate limiting (M10.3): fixed-window counter per client key. Pure
 * and instance-local - on serverless this bounds per-instance abuse and
 * is honest about it (a shared store upgrade slots in behind the same
 * interface when scale demands one). Applied to /api/* writes only; page
 * loads and tRPC reads stay unthrottled.
 */

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

/** Uploads carry multi-MB bodies; keep the write budget tight but usable. */
export const API_WRITE_LIMIT: RateLimitConfig = { windowMs: 60_000, maxRequests: 60 };

interface WindowState {
  windowStart: number;
  count: number;
}

const MAX_TRACKED_KEYS = 10_000; // memory bound: drop oldest wholesale beyond this

export class RateLimiter {
  private windows = new Map<string, WindowState>();

  constructor(private config: RateLimitConfig) {}

  /** Returns true when the request is allowed; false → respond 429. */
  check(key: string, now: number): boolean {
    const state = this.windows.get(key);
    if (!state || now - state.windowStart >= this.config.windowMs) {
      if (this.windows.size >= MAX_TRACKED_KEYS) this.windows.clear();
      this.windows.set(key, { windowStart: now, count: 1 });
      return true;
    }
    state.count += 1;
    return state.count <= this.config.maxRequests;
  }
}
