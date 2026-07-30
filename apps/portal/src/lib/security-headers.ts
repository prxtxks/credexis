/**
 * Security headers for the borrower portal.
 *
 * Duplicated from apps/web rather than imported: the portal is a separate
 * deployment on a separate origin and must not depend on the staff app
 * (design 05 §10.1). Design 05 §4.5 moves this into @credexis/shared in
 * PR 3 - collapse the two copies then, not before.
 *
 * Connect/img origins derive from configured env, never hardcoded, so a
 * project swap cannot silently break the app or quietly widen the policy.
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

  // Auth (magic link exchange) and, from the upload PR onward, the Storage
  // API. Nothing else: the portal talks to exactly one backend.
  const connect = ["'self'", supabase, supabaseWs].filter(Boolean).join(" ");
  // No remote images are rendered on any portal screen today. Widening this
  // is a decision for the PR that first renders one, not a default.
  const img = ["'self'", "data:"].join(" ");

  // WHY NOT nonce + strict-dynamic (it broke apps/web in production,
  // 2026-07-29): `strict-dynamic` makes browsers IGNORE the `'self'`
  // allowlist - only nonced scripts may run. Next can only stamp a
  // per-request nonce onto pages it renders per request; statically
  // prerendered HTML carries none, so every script is blocked, the server
  // HTML paints and nothing hydrates. Dev never shows it because dev renders
  // dynamically. script-src stays host-based here for the same reason.
  const scriptSrc = isDev
    ? // Dev only: HMR/react-refresh evaluate generated code. Never in prod.
      `'self' 'unsafe-inline' 'unsafe-eval'`
    : `'self' 'unsafe-inline'`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // React style props and Next's injected <style> blocks are inline.
    // Inline STYLE is a far smaller surface than inline script.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'", // Geist is self-hosted via next/font - no external CDN.
    `img-src ${img}`,
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    // The claim form posts to this origin only; a borrower's email address
    // must never be POSTable to a third party by an injected form.
    "form-action 'self'",
    // Clickjacking: a lender-branded document portal is a phishing target.
    // frame-ancestors is the modern control; X-Frame-Options covers the rest.
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Headers that never vary per request. */
export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // Borrower PII: never leak a full URL (which can carry an invite token) to
  // a third party via Referer.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  // 2 years + preload-eligible; Vercel terminates TLS, so this is safe.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  // A borrower portal has nothing to gain from search indexing and plenty to
  // lose (invite links pasted into indexed pages, brand impersonation bait).
  "X-Robots-Tag": "noindex, nofollow",
};
