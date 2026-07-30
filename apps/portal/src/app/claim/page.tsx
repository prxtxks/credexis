import { cookies } from "next/headers";
import { startClaim } from "@/lib/actions/claim";
import { CLAIM_COOKIE, CLAIM_ERROR_COPY, claimErrorCode } from "@/lib/claim";

/**
 * Reads a cookie, so it can never be prerendered. Stated explicitly because
 * route segment config is silently IGNORED inside a "use client" module -
 * that is how a per-user page got baked into the build output and froze
 * apps/web in production on 2026-07-29. This page is a Server Component and
 * stays one.
 */
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ClaimPage({ searchParams }: Props) {
  const params = await searchParams;
  const sent = first(params["sent"]) === "1";
  const error = claimErrorCode(first(params["error"]));
  // Middleware moved the token out of the URL into this cookie. Its absence
  // means the 10-minute window lapsed (or the page was opened without a
  // link) - a fact about this browser, not about any invitation.
  const hasToken = (await cookies()).has(CLAIM_COOKIE);

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xl font-semibold tracking-tight">Credexis</p>
          <p className="text-muted-foreground mt-1 text-sm">Secure document portal</p>
        </div>

        <div className="bg-card text-card-foreground rounded-xl border p-6 shadow-sm sm:p-8">
          {error !== null && (
            <p
              role="alert"
              className="border-destructive/40 text-destructive mb-6 rounded-lg border px-4 py-3 text-sm"
            >
              {CLAIM_ERROR_COPY[error]}
            </p>
          )}

          {sent ? (
            <>
              <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
              {/* The one sentence this form is allowed to answer with. It is
                  identical for a valid invitation, an unknown address and a
                  Supabase outage - anything else is an existence oracle. */}
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                If that link is valid, we&apos;ve emailed you a sign-in link.
              </p>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                Open it on this device to continue. You can close this tab.
              </p>
            </>
          ) : hasToken ? (
            <>
              <h1 className="text-xl font-semibold tracking-tight">Send your documents</h1>
              {/* The invitation's label and the lender's name are deliberately
                  absent: identifying either before sign-in would require an
                  anon-readable lookup, and the portal grants `anon` nothing
                  (design 05 §3.3). */}
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                Your lender has asked you for a few documents. Enter the email address your
                invitation was sent to and we&apos;ll email you a sign-in link.
              </p>

              <form action={startClaim} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <label htmlFor="email" className="block text-sm font-medium">
                    Email address
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    autoFocus
                    spellCheck={false}
                    placeholder="you@example.com"
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  className="bg-primary text-primary-foreground w-full rounded-lg px-4 py-2.5 text-sm font-medium"
                >
                  Email me a sign-in link
                </button>
              </form>

              <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
                Use the address your loan officer invited - the link only works for that mailbox.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold tracking-tight">Open your link again</h1>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                This page is only ready for a few minutes after you open the link from your
                invitation email. Go back to that email and open the link again.
              </p>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                If you can&apos;t find it, ask your loan officer to send a new one.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
