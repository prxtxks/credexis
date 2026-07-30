/**
 * The invite-token handoff (design 05 §3.3).
 *
 * The raw token arrives once, in the URL of the emailed invite link. It is
 * moved straight into an httpOnly cookie and stripped from the URL so it never
 * reaches client JS, browser history, a Referer header, or a server log line.
 * It is spent at /auth/callback and cleared in the same response.
 */

export const CLAIM_COOKIE = "cx_bi";

/** 10 minutes: long enough to type an email address, short enough to matter. */
export const CLAIM_COOKIE_MAX_AGE_SECONDS = 600;

/** Minted as randomBytes(32).toString("hex") by apps/web (the 0013 pattern). */
export const CLAIM_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const CLAIM_COOKIE_OPTIONS = {
  httpOnly: true,
  // Always Secure, including local dev: browsers treat http://localhost as a
  // secure context, and a config that only sets it in production is a config
  // that eventually ships without it.
  secure: true,
  // Lax, not Strict: the borrower arrives by following a link from their mail
  // client, which is a cross-site top-level GET.
  sameSite: "lax",
  path: "/",
  maxAge: CLAIM_COOKIE_MAX_AGE_SECONDS,
} as const;

/**
 * Failure buckets rendered on /claim. Coarse on purpose: the portal must not
 * become an oracle for whether an invite exists, and a borrower cannot act on
 * anything finer than "the link is dead" or "wrong mailbox" anyway.
 */
export type ClaimErrorCode = "link" | "email" | "session" | "rate";

export const CLAIM_ERROR_COPY: Record<ClaimErrorCode, string> = {
  link: "This invitation has expired - ask your loan officer for a new link.",
  email:
    "This invitation was sent to a different email address. Open the link from your email again and use the address your loan officer invited.",
  session:
    "That sign-in link didn't work, or it has already been used. Open your invitation link again to get a new one.",
  rate: "Too many attempts from this connection. Wait an hour, then open your invitation link again.",
};

const CODES: readonly ClaimErrorCode[] = ["link", "email", "session", "rate"];

/** Only known codes render; anything else is ignored rather than echoed back. */
export function claimErrorCode(raw: string | undefined): ClaimErrorCode | null {
  return CODES.find((code) => code === raw) ?? null;
}

/**
 * Map a claim_borrower_invite() failure onto a bucket. The definer raises
 * distinct messages for "wrong mailbox" versus everything else (expired,
 * revoked, unknown token, already claimed by another seat); the borrower can
 * only usefully act on the first, so everything else collapses to "link".
 */
export function classifyClaimFailure(message: string): ClaimErrorCode {
  return /different email address/i.test(message) ? "email" : "link";
}
