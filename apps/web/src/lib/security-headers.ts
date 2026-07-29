/**
 * Security headers (M12.3 GAP list — "CSP/security headers").
 *
 * The CSP is NONCE-based, not `unsafe-inline`: Next.js stamps the nonce onto
 * its own hydration scripts when the request carries one, and
 * `strict-dynamic` lets those scripts load the chunks they need without us
 * enumerating hashes. `unsafe-inline` in script-src would defeat the point —
 * it is exactly what a bank's security review flags.
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

export function buildCsp(nonce: string, isDev: boolean): string {
  const supabase = originOf(process.env["NEXT_PUBLIC_SUPABASE_URL"]);
  const supabaseWs = supabase ? supabase.replace(/^https:/, "wss:") : null;
  const sentry = originOf(process.env["NEXT_PUBLIC_SENTRY_DSN"]);

  const connect = ["'self'", supabase, supabaseWs, sentry].filter(Boolean).join(" ");
  // Signed storage URLs (page renders, document previews) come from Supabase.
  const img = ["'self'", "blob:", "data:", supabase].filter(Boolean).join(" ");

  const scriptSrc = isDev
    ? // Dev only: HMR/react-refresh evaluate generated code. Never in prod.
      `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind ships a stylesheet, but React style props and Next's injected
    // <style> blocks are inline. Inline STYLE is a far smaller risk surface
    // than inline script, and nonce-ing every one is not workable today.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'", // Geist is self-hosted via next/font — no external CDN.
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
