/**
 * Security headers (M12.3 GAP list - "CSP/security headers").
 *
 * script-src is HOST-based (see the note in buildCsp): a nonce cannot be
 * stamped onto statically prerendered HTML, and `strict-dynamic` without a
 * nonce blocks every script. Everything else here is strict.
 *
 * Connect/img origins are derived from configured env, never hardcoded, so
 * a project swap can't silently break the app or quietly widen the policy.
 */

function originOf(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

export function buildCsp(isDev: boolean): string {
  const supabase = originOf(process.env["NEXT_PUBLIC_SUPABASE_URL"]);
  const supabaseWs = supabase ? supabase.replace(/^https:/, "wss:") : null;
  const sentry = originOf(process.env["NEXT_PUBLIC_SENTRY_DSN"]);

  const connect = ["'self'", supabase, supabaseWs, sentry].filter(Boolean).join(" ");
  // Signed storage URLs (page renders, document previews) come from Supabase.
  const img = ["'self'", "blob:", "data:", supabase].filter(Boolean).join(" ");

  // WHY NOT nonce + strict-dynamic (it broke production, 2026-07-29):
  // `strict-dynamic` makes browsers IGNORE the `'self'` allowlist - only
  // nonced scripts may run. Next.js can only stamp a per-request nonce onto
  // pages it renders per request; our pages are statically prerendered at
  // build time, so the shipped HTML carried 24 script tags and zero nonces.
  // Every script was blocked: the server HTML painted, nothing hydrated, and
  // the app sat on "Loading your deals…" forever. Dev never showed it
  // because dev renders dynamically.
  //
  // So script-src is host-based. That still blocks the main third-party
  // injection vector (loading script from another origin) while allowing
  // Next's own same-origin chunks and its inline hydration bootstrap.
  // Upgrading to nonces requires forcing dynamic rendering app-wide - a real
  // cost for a real gain, and a deliberate decision, not a silent default.
  const scriptSrc = isDev
    ? // Dev only: HMR/react-refresh evaluate generated code. Never in prod.
      `'self' 'unsafe-inline' 'unsafe-eval'`
    : `'self' 'unsafe-inline'`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind ships a stylesheet, but React style props and Next's injected
    // <style> blocks are inline. Inline STYLE is a far smaller risk surface
    // than inline script, and nonce-ing every one is not workable today.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'", // Geist is self-hosted via next/font - no external CDN.
    `img-src ${img}`,
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Clickjacking: this app is never framed. frame-ancestors is the modern
    // control; X-Frame-Options below covers browsers that ignore it.
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Headers that never vary per request. */
export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // Tax PII: never leak a full URL (which carries deal ids) to third parties.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  // 2 years + preload-eligible; Vercel terminates TLS, so this is safe.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};
