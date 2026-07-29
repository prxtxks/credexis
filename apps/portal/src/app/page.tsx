import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/actions/session";
import {
  STATUS_COPY,
  formatDate,
  parsePortalState,
  type PortalState,
  type PortalUpload,
} from "@/lib/portal-state";
import { createClient } from "@/lib/supabase/server";

/**
 * The borrower's only screen. Per-user and authenticated, so it must never be
 * prerendered — and route segment config like this is silently IGNORED inside
 * a "use client" module, which is exactly how an anonymous shell got baked
 * into apps/web's build output and froze production on 2026-07-29. This page
 * is a Server Component and stays one.
 */
export const dynamic = "force-dynamic";

/**
 * Everything rendered here comes from one `borrower_portal_state()` call and
 * nothing else. The definer derives the invite from auth.uid(), takes no
 * caller-supplied id, and returns only curated fields — no metrics, no facts,
 * no issues, no gates, no deal status, no org member names, no other
 * borrower's documents (design 05 §10.3). This component renders; it computes
 * nothing (Iron Law #3).
 */
export default async function PortalHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Middleware already gates this; re-checking here means a middleware matcher
  // mistake cannot expose the page on its own.
  if (!user) redirect("/signed-out");

  const { data, error } = await supabase.rpc("borrower_portal_state");
  if (error) console.error("portal: borrower_portal_state failed", error.message);
  const { invites, malformed } = parsePortalState(data);

  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div>
            <p className="font-semibold tracking-tight">Credexis</p>
            <p className="text-muted-foreground text-xs">Secure document portal</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="text-muted-foreground rounded-lg border px-3 py-1.5 text-sm"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {error !== null ? (
          <Panel title="We couldn't load your documents">
            Something went wrong on our side. Refresh the page in a moment, or ask your loan officer
            if it keeps happening.
          </Panel>
        ) : invites.length === 0 ? (
          <Panel title="No active invitation">
            This account doesn&apos;t have an active invitation right now. It may have expired or
            been withdrawn — ask your loan officer for a new link.
          </Panel>
        ) : (
          <div className="space-y-10">
            {invites.length > 1 && (
              <h1 className="text-2xl font-semibold tracking-tight">Your documents</h1>
            )}
            {invites.map((invite) => (
              <InviteSection key={invite.inviteId} invite={invite} asH1={invites.length === 1} />
            ))}
          </div>
        )}

        {malformed > 0 && (
          <p className="text-muted-foreground mt-8 text-xs">
            Some items couldn&apos;t be displayed here. Anything you have already sent is still with
            your loan officer.
          </p>
        )}
      </main>
    </div>
  );
}

function InviteSection({ invite, asH1 }: { invite: PortalState; asH1: boolean }) {
  const status = STATUS_COPY[invite.status];
  const expires = formatDate(invite.expiresAt);
  const headingClass = "text-2xl font-semibold tracking-tight";

  return (
    <section className="space-y-6">
      <div>
        {asH1 ? (
          <h1 className={headingClass}>{invite.label}</h1>
        ) : (
          <h2 className={headingClass}>{invite.label}</h2>
        )}
        {invite.entityLabel && (
          <p className="text-muted-foreground mt-1 text-sm">{invite.entityLabel}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* Only the five curated strings can reach this chip: the parser
              coerces anything else, so an internal status can never surface. */}
          <span className="bg-accent text-accent-foreground rounded-full px-3 py-1 text-xs font-medium">
            {status.label}
          </span>
          <span className="text-muted-foreground text-sm">{status.hint}</span>
        </div>
        {expires && (
          <p className="text-muted-foreground mt-2 text-xs">This page works until {expires}.</p>
        )}
      </div>

      {invite.requests.length > 0 && (
        <Card title="Messages from your loan officer">
          <ul className="space-y-4">
            {invite.requests.map((request) => {
              const asked = formatDate(request.createdAt);
              return (
                <li key={request.id} className="text-sm leading-relaxed">
                  <p>{request.note}</p>
                  {asked && <p className="text-muted-foreground mt-1 text-xs">Asked {asked}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="What we need">
        {invite.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing is listed yet. Your loan officer will let you know what to send.
          </p>
        ) : (
          <ul className="space-y-3">
            {invite.items.map((item) => (
              <li key={item.key} className="flex items-start justify-between gap-4 text-sm">
                <span className="flex items-start gap-2">
                  <span aria-hidden="true" className="text-muted-foreground">
                    {item.satisfied ? "✓" : "○"}
                  </span>
                  <span>{item.label}</span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {item.satisfied ? "Received" : "Still needed"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="What you've sent">
        {invite.uploads.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing received yet.</p>
        ) : (
          <ul className="space-y-3">
            {invite.uploads.map((upload, index) => (
              <UploadRow key={`${upload.fileName}-${index}`} upload={upload} />
            ))}
          </ul>
        )}
        {/* Uploading from this page arrives in the next PR (design 05 §12,
            PR 6). Saying so beats a disabled button the borrower will poke. */}
        <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
          Sending files from this page isn&apos;t available yet — reply to your loan officer&apos;s
          email to send documents.
        </p>
      </Card>
    </section>
  );
}

function UploadRow({ upload }: { upload: PortalUpload }) {
  const sent = formatDate(upload.uploadedAt);
  // Two-valued by design: the borrower never learns whether extraction ran,
  // succeeded, or exists — only whether the file needs sending again.
  const needsReplacement = upload.state === "needs_replacement";

  return (
    <li className="flex items-start justify-between gap-4 text-sm">
      <span className="flex items-start gap-2">
        <span aria-hidden="true" className={needsReplacement ? "text-destructive" : ""}>
          {needsReplacement ? "!" : "✓"}
        </span>
        <span>
          <span className="break-all">{upload.fileName}</span>
          {needsReplacement && (
            <span className="text-destructive block text-xs">
              Couldn&apos;t read this — please upload it again
            </span>
          )}
        </span>
      </span>
      {sent && <span className="text-muted-foreground shrink-0 text-xs">{sent}</span>}
    </li>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-card text-card-foreground rounded-xl border p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold tracking-tight">{title}</h3>
      {children}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-card text-card-foreground rounded-xl border p-6 shadow-sm">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{children}</p>
    </div>
  );
}
