import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { CLAIM_COOKIE, CLAIM_COOKIE_OPTIONS, CLAIM_TOKEN_PATTERN } from "@/lib/claim";
import { supabaseEnv } from "@/lib/env";
import { API_WRITE_LIMIT, CLAIM_START_LIMIT, RateLimiter } from "@/lib/rate-limit";
import { STATIC_SECURITY_HEADERS, buildCsp } from "@/lib/security-headers";
import { MAX_SESSION_AGE_MS, sessionStartedAtMs } from "@/lib/session-age";

const apiWriteLimiter = new RateLimiter(API_WRITE_LIMIT);
const claimStartLimiter = new RateLimiter(CLAIM_START_LIMIT);

/**
 * Reachable without a session. Everything else requires a verified user.
 * There is no /login here — the emailed link is the only door.
 */
const PUBLIC_PATHS = ["/claim", "/auth", "/signed-out"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function clientKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * Route guard, session refresh, token handoff and security headers for the
 * borrower portal (design 05 §10.1).
 *
 * Fail-closed throughout: `getUser()` revalidates the JWT against the auth
 * server (never trust the cookie alone), and any error — auth server
 * unreachable, env missing — is treated as signed out, never as signed in.
 */
export async function middleware(request: NextRequest) {
  // Defined FIRST so every exit below — rate-limit rejections and redirects
  // included — carries the same headers. No route ships unprotected.
  const csp = buildCsp(process.env.NODE_ENV === "development");
  const secured = (res: NextResponse): NextResponse => {
    res.headers.set("Content-Security-Policy", csp);
    for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) res.headers.set(k, v);
    return res;
  };

  const { pathname } = request.nextUrl;

  // Cheapest rejections first, before any auth work.
  if (pathname.startsWith("/api/") && request.method !== "GET") {
    if (!apiWriteLimiter.check(clientKey(request), Date.now())) {
      return secured(NextResponse.json({ error: "rate limited" }, { status: 429 }));
    }
  }

  // Claim-start is a POST to /claim (the form's server action). Throttled far
  // harder than API writes because each one asks Supabase to send an email to
  // an address the caller chose (R-9). 303 so the browser follows with GET
  // and the borrower gets a rendered page rather than a raw JSON body.
  if (pathname === "/claim" && request.method === "POST") {
    if (!claimStartLimiter.check(clientKey(request), Date.now())) {
      const url = request.nextUrl.clone();
      url.search = "?error=rate";
      return secured(NextResponse.redirect(url, 303));
    }
  }

  // The invite token must never linger in a URL — browser history, Referer
  // headers and access logs all outlive the 10-minute cookie. Move it into
  // httpOnly storage and bounce to the clean path (design 05 §3.3, step 2).
  // GET only: a 307 on a POST would replay the request body against the clean
  // URL, and the form never carries the token anyway.
  if (
    pathname === "/claim" &&
    request.method === "GET" &&
    request.nextUrl.searchParams.has("token")
  ) {
    const token = request.nextUrl.searchParams.get("token") ?? "";
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("token");
    const res = secured(NextResponse.redirect(clean));
    // A malformed token is dropped silently rather than answered with an
    // error: the shape of the token is not something this page confirms.
    if (CLAIM_TOKEN_PATTERN.test(token)) {
      res.cookies.set(CLAIM_COOKIE, token, CLAIM_COOKIE_OPTIONS);
    }
    return res;
  }

  let response = NextResponse.next({ request });
  let supabase: SupabaseClient | null = null;
  let userId: string | null = null;
  let lastSignInAt: string | null = null;
  let accessToken: string | null = null;

  const env = supabaseEnv();
  if (env) {
    try {
      supabase = createServerClient(env.url, env.anonKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value } of cookiesToSet) {
              request.cookies.set(name, value);
            }
            response = NextResponse.next({ request });
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options);
            }
          },
        },
      });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        userId = user.id;
        lastSignInAt = user.last_sign_in_at ?? null;
        // Read only after getUser() has verified the same token; this is for
        // the `iat`/`amr` timestamps, not for authorization.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        accessToken = session?.access_token ?? null;
      }
    } catch {
      userId = null; // fail closed
    }
  }

  if (userId) {
    const startedAt = sessionStartedAtMs(accessToken, lastSignInAt);
    if (startedAt === null) {
      // Deliberately fails OPEN, loudly. Failing closed on an unreadable
      // timestamp would sign every borrower out on every request — an
      // infinite /signed-out loop is a worse outage than a long session, and
      // R-2 already says the invite's expires_at is the real bound.
      console.error("portal: could not determine session start; age check skipped");
    } else if (Date.now() - startedAt > MAX_SESSION_AGE_MS) {
      return secured(await signOutRedirect(request, supabase));
    }
  }

  // API routes authenticate themselves and must answer with status codes, not
  // redirects (a 307 turns an unauthenticated POST into a 404).
  if (pathname.startsWith("/api/")) return secured(response);

  if (!userId && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/signed-out";
    // No `next` parameter: the portal has one screen, and a redirect target
    // carried in a query string is an open-redirect waiting to happen.
    url.search = "";
    return secured(NextResponse.redirect(url));
  }

  return secured(response);
}

/**
 * Terminate the session and send the borrower to /signed-out. The explicit
 * cookie expiry is the guarantee, not the signOut() call: if the auth server
 * is unreachable the browser must still lose its session cookies.
 */
async function signOutRedirect(
  request: NextRequest,
  supabase: SupabaseClient | null,
): Promise<NextResponse> {
  try {
    await supabase?.auth.signOut();
  } catch {
    // Cookie expiry below is what actually ends the session for this browser.
  }
  const url = request.nextUrl.clone();
  url.pathname = "/signed-out";
  url.search = "";
  const res = NextResponse.redirect(url);
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-")) res.cookies.set(cookie.name, "", { maxAge: 0, path: "/" });
  }
  res.cookies.set(CLAIM_COOKIE, "", { ...CLAIM_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
