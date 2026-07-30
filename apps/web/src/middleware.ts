import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { API_WRITE_LIMIT, RateLimiter } from "@/lib/rate-limit";
import { STATIC_SECURITY_HEADERS, buildCsp } from "@/lib/security-headers";

/** M10.3: per-instance write throttle for /api/* (60/min per client). */
const apiWriteLimiter = new RateLimiter(API_WRITE_LIMIT);

/** Routes reachable without a session. Everything else requires sign-in. */
const PUBLIC_PATHS = ["/login", "/signup", "/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Route guard + session refresh (M2.3). Every request: refresh the Supabase
 * session cookies, then gate non-public routes on a verified user
 * (`getUser()` revalidates the JWT against the auth server - never trust the
 * cookie alone). Errors (e.g. auth server unreachable) are treated as
 * signed-out, never as signed-in.
 */
export async function middleware(request: NextRequest) {
  // M12.3 security headers. Defined FIRST so every exit below - including
  // the rate-limit rejection - carries them.
  const csp = buildCsp(process.env.NODE_ENV === "development");
  /** Every return path carries the same headers - no route ships unprotected. */
  const secured = (res: NextResponse): NextResponse => {
    res.headers.set("Content-Security-Policy", csp);
    for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) res.headers.set(k, v);
    return res;
  };

  // Rate limit API writes BEFORE any auth work (cheapest rejection first).
  const { pathname: path } = request.nextUrl;
  if (path.startsWith("/api/") && request.method !== "GET") {
    const clientKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!apiWriteLimiter.check(clientKey, Date.now())) {
      return secured(NextResponse.json({ error: "rate limited" }, { status: 429 }));
    }
  }

  let response = NextResponse.next({ request });

  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

  let signedIn = false;
  if (url && anonKey) {
    try {
      const supabase = createServerClient(url, anonKey, {
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
      signedIn = user !== null;
    } catch {
      signedIn = false; // fail closed
    }
  }

  const { pathname } = request.nextUrl;
  // API routes authenticate themselves and must answer with status codes,
  // not login redirects (a 307 turns an unauthenticated POST into a 404).
  if (pathname.startsWith("/api/")) return secured(response);
  if (!signedIn && !isPublic(pathname)) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", pathname);
    return secured(NextResponse.redirect(redirect));
  }
  if (signedIn && pathname === "/login") {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/";
    redirect.search = "";
    return secured(NextResponse.redirect(redirect));
  }
  return secured(response);
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
