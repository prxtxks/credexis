"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CLAIM_COOKIE } from "@/lib/claim";
import { portalOrigin } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** RFC-practical shape check only; Supabase is the real validator. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

/**
 * Start the claim: send a magic link to the address the borrower types
 * (design 05 §3.3, step 3).
 *
 * NEUTRAL BY CONSTRUCTION. Unknown invite, wrong address, malformed input,
 * Supabase outage — every path ends on the same /claim?sent=1 screen with the
 * same sentence. A branch that answered differently would turn this form into
 * an invite/email-existence oracle, and this page is reachable by anyone who
 * obtains a link.
 *
 * No database function is consulted here, so `anon` gains no privilege: this
 * is Supabase's own auth endpoint doing what it is for. The second factor is
 * control of the invited mailbox — claim_borrower_invite() refuses a session
 * whose email is not the invitee's, so the link alone is worthless.
 */
export async function startClaim(formData: FormData): Promise<void> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  const store = await cookies();
  // No token in hand means nothing to claim even if the sign-in succeeded.
  // Declining here (rather than mailing anyway) is the cheap half of R-9:
  // drive-by magic-link spam needs a live link, not just the URL of this page.
  if (!store.has(CLAIM_COOKIE)) redirect("/claim");

  if (email.length > 0 && email.length <= EMAIL_MAX_LENGTH && EMAIL_SHAPE.test(email)) {
    await sendMagicLink(email);
  }

  redirect("/claim?sent=1");
}

async function sendMagicLink(email: string): Promise<void> {
  const origin = portalOrigin();
  if (!origin) {
    // Without our own origin Supabase would fall back to its project Site URL,
    // which is the STAFF app: the borrower would be signed into a workspace
    // where they are a profile-less nobody, and the invite would never claim.
    console.error("portal: NEXT_PUBLIC_PORTAL_URL is not configured — magic link not sent");
    return;
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${origin}/auth/callback`,
      },
    });
    // supabase-js returns errors, it does not throw them — an unlogged error
    // here is a borrower who never receives their link and a support ticket
    // with nothing behind it.
    if (error) console.error("portal: magic link send failed", error.message);
  } catch (cause) {
    console.error("portal: magic link send threw", cause);
  }
}
