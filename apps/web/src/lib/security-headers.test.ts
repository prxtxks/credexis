import { afterEach, describe, expect, it } from "vitest";
import { STATIC_SECURITY_HEADERS, buildCsp } from "./security-headers";

/**
 * REGRESSION TEST for the 2026-07-29 production outage.
 *
 * A CSP shipped with `script-src 'self' 'nonce-…' 'strict-dynamic'`. Browsers
 * IGNORE the `'self'` allowlist once `strict-dynamic` is present — only nonced
 * scripts may run — and Next.js can only stamp a per-request nonce onto pages
 * it renders per request. Our pages are statically prerendered, so the shipped
 * HTML carried 24 script tags and zero nonces: every script was blocked, the
 * server HTML painted, nothing hydrated, and the app sat on a loading screen.
 *
 * `next build` exited 0 and every existing gate passed. These assertions are
 * the cheap half of preventing a repeat; the browser-level half is
 * e2e/prod-smoke.spec.ts.
 */

const saved = new Map<string, string | undefined>();
function setEnv(key: string, value: string | undefined): void {
  if (!saved.has(key)) saved.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
afterEach(() => {
  for (const [k, v] of saved) setEnv(k, v);
  saved.clear();
});

/** Pull one directive out of a policy string. */
function directive(csp: string, name: string): string {
  const found = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  return found ?? "";
}

describe("buildCsp — the outage that must not repeat", () => {
  it("script-src NEVER combines strict-dynamic with a host allowlist", () => {
    // The exact shape that broke production. 'strict-dynamic' silently voids
    // 'self', so this pairing means "block everything unless nonced" — and
    // prerendered pages have no nonce to offer.
    for (const isDev of [true, false]) {
      const script = directive(buildCsp(isDev), "script-src");
      expect(script, `isDev=${isDev}`).not.toContain("strict-dynamic");
      expect(script, `isDev=${isDev}`).toContain("'self'");
    }
  });

  it("script-src does not reference a nonce it cannot supply", () => {
    // A nonce in the policy with no nonce on the script tags is the failure.
    // If nonces return, they must arrive WITH dynamic rendering, and this
    // assertion should be replaced deliberately rather than deleted quietly.
    for (const isDev of [true, false]) {
      expect(directive(buildCsp(isDev), "script-src")).not.toMatch(/nonce-/);
    }
  });

  it("unsafe-eval is dev-only — never in production", () => {
    expect(directive(buildCsp(true), "script-src")).toContain("'unsafe-eval'");
    expect(directive(buildCsp(false), "script-src")).not.toContain("'unsafe-eval'");
  });

  it("upgrade-insecure-requests is production-only", () => {
    // In dev it would break http://localhost.
    expect(buildCsp(false)).toContain("upgrade-insecure-requests");
    expect(buildCsp(true)).not.toContain("upgrade-insecure-requests");
  });
});

describe("buildCsp — the directives a bank asks about", () => {
  it("clickjacking, base-tag and form hijacking are closed", () => {
    const csp = buildCsp(false);
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
  });

  it("connect-src includes Supabase and its websocket origin, derived from env", () => {
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    const connect = directive(buildCsp(false), "connect-src");
    expect(connect).toContain("https://abc.supabase.co");
    expect(connect).toContain("wss://abc.supabase.co");
  });

  it("a malformed or absent Supabase URL degrades to 'self' rather than a broken origin", () => {
    for (const bad of [undefined, "", "not-a-url"]) {
      setEnv("NEXT_PUBLIC_SUPABASE_URL", bad);
      const connect = directive(buildCsp(false), "connect-src");
      expect(connect, String(bad)).toBe("connect-src 'self'");
      expect(connect, String(bad)).not.toContain("undefined");
      expect(connect, String(bad)).not.toContain("null");
    }
  });

  it("origins are never hardcoded — swapping the project swaps the policy", () => {
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://one.supabase.co");
    const first = buildCsp(false);
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://two.supabase.co");
    const second = buildCsp(false);
    expect(first).not.toBe(second);
    expect(second).not.toContain("one.supabase.co");
  });

  it("img-src allows Supabase signed URLs, blob and data (page renders)", () => {
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    const img = directive(buildCsp(false), "img-src");
    for (const needed of ["'self'", "blob:", "data:", "https://abc.supabase.co"]) {
      expect(img, needed).toContain(needed);
    }
  });

  it("fonts are self-hosted — no external font origin is permitted", () => {
    expect(directive(buildCsp(false), "font-src")).toBe("font-src 'self'");
  });
});

describe("STATIC_SECURITY_HEADERS", () => {
  it("carries the headers a vendor-security questionnaire names", () => {
    expect(STATIC_SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(STATIC_SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(STATIC_SECURITY_HEADERS["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(STATIC_SECURITY_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  it("HSTS is long-lived, covers subdomains and is preload-eligible", () => {
    const hsts = STATIC_SECURITY_HEADERS["Strict-Transport-Security"] ?? "";
    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
    expect(maxAge).toBeGreaterThanOrEqual(31_536_000); // ≥ 1 year
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).toContain("preload");
  });

  it("Referrer-Policy never leaks a full URL cross-origin — deal ids live in paths", () => {
    expect(STATIC_SECURITY_HEADERS["Referrer-Policy"]).not.toMatch(
      /^(unsafe-url|no-referrer-when-downgrade|origin-when-cross-origin)$/,
    );
  });

  it("Permissions-Policy denies the hardware an underwriting app never needs", () => {
    const pp = STATIC_SECURITY_HEADERS["Permissions-Policy"] ?? "";
    for (const feature of ["camera", "microphone", "geolocation"]) {
      expect(pp, feature).toContain(`${feature}=()`);
    }
  });
});
