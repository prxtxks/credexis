import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter (M10.3)", () => {
  it("allows up to the budget within a window, then refuses", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 3 });
    expect(limiter.check("ip-1", 0)).toBe(true);
    expect(limiter.check("ip-1", 10)).toBe(true);
    expect(limiter.check("ip-1", 20)).toBe(true);
    expect(limiter.check("ip-1", 30)).toBe(false);
  });

  it("resets when the window elapses", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
    expect(limiter.check("ip-1", 0)).toBe(true);
    expect(limiter.check("ip-1", 1)).toBe(false);
    expect(limiter.check("ip-1", 60_000)).toBe(true);
  });

  it("tracks clients independently", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
    expect(limiter.check("ip-1", 0)).toBe(true);
    expect(limiter.check("ip-2", 0)).toBe(true);
    expect(limiter.check("ip-1", 1)).toBe(false);
  });
});
