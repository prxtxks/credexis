import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  CLAIM_COOKIE,
  CLAIM_COOKIE_OPTIONS,
  classifyClaimFailure,
  type ClaimErrorCode,
} from "@/lib/claim";
import { createClient } from "@/lib/supabase/server";

/** Reads cookies and the query string - never a static route. */
export const dynamic = "force-dynamic";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["magiclink", "email", "signup", "invite"];

/**
 * Magic-link landing (design 05 §3.3, step 4): exchange the one-time code for
 * a session, spend the stashed invite token against claim_borrower_invite(),
 * clear the cookie, and land the borrower on their one screen.
 *
 * Every failure ends signed OUT and back on /claim with plain copy. The claim
 * is the only thing that turns an auth.users row into a borrower; a session
 * that failed to claim has no business holding a cookie here.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = await cookies();
  const token = store.get(CLAIM_COOKIE)?.value ?? null;

  const clearClaimCookie = () => {
    store.set(CLAIM_COOKIE, "", { ...CLAIM_COOKIE_OPTIONS, maxAge: 0 });
  };
  const back = (code: ClaimErrorCode) => {
    clearClaimCookie();
    return NextResponse.redirect(new URL(`/claim?error=${code}`, url.origin));
  };

  // Supabase reports its own failures (expired or already-consumed link) on
  // the query string rather than by omitting the code.
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) {
    console.error("portal: auth callback rejected by provider", providerError);
    return back("session");
  }

  const supabase = await createClient();
  const authFailure = await establishSession(supabase, url);
  if (authFailure) {
    console.error("portal: session exchange failed", authFailure);
    return back("session");
  }

  if (!token) {
    // A returning borrower signing in again: there is nothing to claim, and
    // their existing invites still resolve from auth.uid() on the next page.
    return NextResponse.redirect(new URL("/", url.origin));
  }

  const { error } = await supabase.rpc("claim_borrower_invite", { p_token: token });
  if (error) {
    console.error("portal: claim_borrower_invite failed", error.message);
    try {
      await supabase.auth.signOut();
    } catch (cause) {
      console.error("portal: sign out after failed claim threw", cause);
    }
    return back(classifyClaimFailure(error.message));
  }

  clearClaimCookie();
  return NextResponse.redirect(new URL("/", url.origin));
}

/** Returns null on success, or a message describing why no session exists. */
async function establishSession(supabase: SupabaseServerClient, url: URL): Promise<string | null> {
  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? error.message : null;
  }

  // Fallback for projects whose email template links straight to the token
  // hash instead of the PKCE code exchange.
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type") ?? "email";
  const type = EMAIL_OTP_TYPES.find((candidate) => candidate === rawType);
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    return error ? error.message : null;
  }

  return "no code or token_hash on the callback URL";
}
