import { describe, expect, it } from "vitest";
import { API_WRITE_LIMIT, CLAIM_START_LIMIT, RateLimiter } from "./rate-limit";

/**
 * The claim-start throttle is the only thing standing between a leaked invite
 * link and using our auth server to email strangers (R-9). It is worth tests
 * that attack it rather than demonstrate it.
 *
 * Time is always passed in explicitly — no Date.now() anywhere — so these are
 * deterministic rather than dependent on how fast the suite runs.
 */

describe("RateLimiter", () => {
  it("allows exactly maxRequests in a window, then rejects", () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 });
    expect([1, 2, 3].map(() => limiter.check("ip", 0))).toEqual([true, true, true]);
    expect(limiter.check("ip", 0)).toBe(false);
  });

  it("keeps rejecting for the REST of the window — no leak on continued abuse", () => {
    // The counter must keep incrementing past the limit; an implementation
    // that stopped counting would let every later request through.
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 2 });
    limiter.check("ip", 0);
    limiter.check("ip", 0);
    for (const t of [100, 500, 999]) {
      expect(limiter.check("ip", t), `t=${t}`).toBe(false);
    }
  });

  it("opens a fresh window exactly at the boundary, not before", () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1 });
    expect(limiter.check("ip", 0)).toBe(true);
    expect(limiter.check("ip", 999)).toBe(false); // still the old window
    expect(limiter.check("ip", 1000)).toBe(true); // boundary is inclusive
  });

  it("tracks keys independently — one abuser cannot lock out everyone", () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1 });
    expect(limiter.check("abuser", 0)).toBe(true);
    expect(limiter.check("abuser", 0)).toBe(false);
    // A real borrower on a different IP is unaffected.
    expect(limiter.check("borrower", 0)).toBe(true);
  });

  it("the memory bound cannot be used to erase an active limit cheaply", () => {
    // Beyond MAX_TRACKED_KEYS the map is cleared wholesale, which resets
    // everyone's window. That is a deliberate memory trade-off, so pin the
    // COST of exploiting it: it takes 10k distinct keys, not a handful.
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
    expect(limiter.check("victim", 0)).toBe(true);
    expect(limiter.check("victim", 1)).toBe(false);

    for (let i = 0; i < 9_000; i++) limiter.check(`filler-${i}`, 1);
    expect(limiter.check("victim", 2), "9k keys must NOT reset the window").toBe(false);

    for (let i = 9_000; i < 10_001; i++) limiter.check(`filler-${i}`, 1);
    expect(limiter.check("victim", 3), "past the bound the window does reset").toBe(true);
  });

  it("claim-start is far tighter than the write budget — R-9 is the reason", () => {
    // If these ever converge, someone has widened the magic-link throttle to
    // match a general write limit, which is the bug this asserts against.
    expect(CLAIM_START_LIMIT.maxRequests).toBeLessThan(API_WRITE_LIMIT.maxRequests);
    expect(CLAIM_START_LIMIT.windowMs).toBeGreaterThan(API_WRITE_LIMIT.windowMs);
    // 5 emails per hour per IP: enough for a borrower retrying, useless for bombing.
    expect(CLAIM_START_LIMIT).toEqual({ windowMs: 3_600_000, maxRequests: 5 });
  });

  it("a borrower who genuinely mistypes their email is not locked out", () => {
    // The throttle must survive real use: five attempts in an hour is the
    // budget, and a legitimate borrower rarely needs two.
    const limiter = new RateLimiter(CLAIM_START_LIMIT);
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("borrower-ip", i * 1000), `attempt ${i + 1}`).toBe(true);
    }
    expect(limiter.check("borrower-ip", 6000)).toBe(false);
    // …and an hour later they can try again.
    expect(limiter.check("borrower-ip", 3_600_001)).toBe(true);
  });
});
