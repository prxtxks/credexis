/**
 * Absolute session age (design 05 §10.1).
 *
 * The portal signs a borrower out beyond a fixed wall-clock age regardless of
 * refresh activity. R-2 is explicit that this is an app-layer control, not the
 * real boundary — a stolen refresh token can still talk to PostgREST/Storage
 * directly, and what actually bounds it is the invite's expires_at plus the
 * per-statement status/revoked_at/expires_at re-check inside every definer.
 */

export const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000;

interface AccessTokenClaims {
  iat?: unknown;
  amr?: unknown;
}

/**
 * Decode (never verify) an access token's claims. Verification is getUser()'s
 * job against the auth server; this only reads timestamps out of a token that
 * has already been verified.
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    const decoded = JSON.parse(atob(padded)) as unknown;
    return typeof decoded === "object" && decoded !== null
      ? (decoded as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function seconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value * 1000 : null;
}

/**
 * Wall-clock instant the borrower actually authenticated, in ms.
 *
 * NOT `iat` alone: Supabase re-stamps `iat` on every hourly token refresh, so
 * an iat-only check never trips and the "12 hour" ceiling would be fiction.
 * `amr[].timestamp` (the authentication-method instant) and
 * `user.last_sign_in_at` survive refresh. The OLDEST available signal wins —
 * the conservative reading of an ambiguous set.
 */
export function sessionStartedAtMs(
  accessToken: string | null,
  lastSignInAt: string | null,
): number | null {
  const candidates: number[] = [];

  if (accessToken) {
    const claims = (decodeJwtClaims(accessToken) ?? {}) as AccessTokenClaims;
    const iat = seconds(claims.iat);
    if (iat !== null) candidates.push(iat);
    if (Array.isArray(claims.amr)) {
      for (const entry of claims.amr) {
        if (typeof entry !== "object" || entry === null) continue;
        const ts = seconds((entry as { timestamp?: unknown }).timestamp);
        if (ts !== null) candidates.push(ts);
      }
    }
  }

  if (lastSignInAt) {
    const parsed = Date.parse(lastSignInAt);
    if (Number.isFinite(parsed)) candidates.push(parsed);
  }

  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}
