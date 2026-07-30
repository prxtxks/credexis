/**
 * Fixed-window rate limiting, instance-local and honest about it: on
 * serverless this bounds per-instance abuse, and a shared store slots in
 * behind the same interface when scale demands one.
 *
 * Duplicated from apps/web rather than imported - the portal is a separate
 * deployment with no dependency on the staff app (design 05 §10.1). Design
 * 05 §4.5 moves this into @credexis/shared in PR 3; collapse then.
 */

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

/** Uploads carry multi-MB bodies; keep the write budget tight but usable. */
export const API_WRITE_LIMIT: RateLimitConfig = { windowMs: 60_000, maxRequests: 60 };

/**
 * Claim-start (magic-link issuance). R-9: someone holding a leaked invite link
 * could otherwise email-bomb third parties and inflate auth.users, so this is
 * far tighter than the write budget.
 */
export const CLAIM_START_LIMIT: RateLimitConfig = { windowMs: 3_600_000, maxRequests: 5 };

interface WindowState {
  windowStart: number;
  count: number;
}

const MAX_TRACKED_KEYS = 10_000; // memory bound: drop oldest wholesale beyond this

export class RateLimiter {
  private windows = new Map<string, WindowState>();

  constructor(private config: RateLimitConfig) {}

  /** Returns true when the request is allowed; false → reject. */
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
