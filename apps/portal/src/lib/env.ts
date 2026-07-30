/**
 * Portal environment access. Centralised so a missing variable surfaces in one
 * obvious place instead of as a null-deref halfway through an auth flow.
 */

/** Anon key only. Iron Law #7: a service-role key never enters a request path. */
export function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Absolute origin of THIS deployment, used as the magic-link landing origin.
 *
 * Deliberately NOT derived from the Host header: Supabase mails the value we
 * pass, so an attacker-controlled Host would put their origin into an email
 * a real borrower receives. A missing/invalid value returns null and the
 * caller declines to send - a link that lands on the staff app would sign the
 * borrower into a workspace where they are a profile-less nobody.
 */
export function portalOrigin(): string | null {
  const raw = process.env["NEXT_PUBLIC_PORTAL_URL"];
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}
