"use client";

/**
 * Borrower invitations, broker side (M12.1, design 05 §10.5).
 *
 * The broker's whole borrower-portal surface: who has been invited, the
 * one-time claim link, chasing (extend / request documents), and the curated
 * status the borrower sees. Every write is a tRPC mutation on the
 * underwriter tier; RLS and the 0026 guards are the real enforcement — this
 * page is honest UX over them, so denials surface as errors, never as silent
 * no-ops.
 *
 * Three shapes are load-bearing:
 * - The raw claim URL comes back from `create` EXACTLY ONCE and is built
 *   server-side against the PORTAL origin (never window.location.origin, as
 *   /org/members does — that link is same-app). Lost links are re-minted.
 * - Revocation is ONE-WAY (0026): the confirm step says so in words before
 *   the button that does it, because nothing can undo it afterwards.
 * - Portal status is broker-curated and three-valued, deliberately NOT
 *   deals.status — internal pipeline state must never leak to a borrower.
 *
 * This is a single "use client" module with no server wrapper, unlike `/`:
 * `/deals/[dealId]/*` is a dynamic segment with no generateStaticParams, so
 * Next never prerenders it and there is no anonymous shell to bake in.
 */

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Ban,
  CalendarClock,
  Copy,
  Loader2,
  Mail,
  MessageSquarePlus,
  Send,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const WRITE_ROLES = ["org_owner", "admin", "underwriter"];

type StatusChip = { label: string; variant: "default" | "secondary" | "destructive" | "outline" };

const STATUS_LABEL: Record<string, StatusChip> = {
  pending: { label: "Invited", variant: "secondary" },
  active: { label: "Active", variant: "default" },
  revoked: { label: "Revoked", variant: "destructive" },
  expired: { label: "Expired", variant: "outline" },
};

const PORTAL_STATUS = [
  { value: "collecting", label: "Collecting documents" },
  { value: "in_review", label: "In review" },
  { value: "complete", label: "Collection complete" },
] as const;

/** Textarea mirrors <Input>'s field styling; there is no shared primitive yet. */
const TEXTAREA_CLASS =
  "placeholder:text-muted-foreground dark:bg-input/30 border-input w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function BorrowerInvitesPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const utils = trpc.useUtils();

  const me = trpc.me.useQuery();
  const deal = trpc.deals.get.useQuery({ dealId });
  const borrowers = trpc.borrowers.list.useQuery();
  const entities = trpc.assignment.entities.useQuery({ dealId });
  const invites = trpc.borrowerInvites.forDeal.useQuery({ dealId });
  const requests = trpc.documentRequests.forDeal.useQuery({ dealId });

  // Composer
  const [borrowerId, setBorrowerId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [entityId, setEntityId] = useState("");
  const [displayLabel, setDisplayLabel] = useState("");
  const [claimLink, setClaimLink] = useState<string | null>(null);

  // Per-invite panels: at most one note box and one armed revoke at a time.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [revokeArmed, setRevokeArmed] = useState<string | null>(null);

  const refreshInvites = () => void utils.borrowerInvites.forDeal.invalidate({ dealId });
  const refreshRequests = () => void utils.documentRequests.forDeal.invalidate({ dealId });

  const createBorrower = trpc.borrowers.create.useMutation();
  const createInvite = trpc.borrowerInvites.create.useMutation({
    onSuccess: (r) => {
      setClaimLink(r.claimUrl);
      setBorrowerId("");
      setFullName("");
      setEmail("");
      setEntityId("");
      setDisplayLabel("");
      refreshInvites();
      void utils.borrowers.list.invalidate();
      toast.success(
        r.emailSent
          ? "Invitation emailed — the link below works too"
          : "Invitation created — copy the link below and send it",
      );
    },
  });
  const extend = trpc.borrowerInvites.extend.useMutation({
    onSuccess: (r) => {
      refreshInvites();
      toast.success(`Extended — now expires ${shortDate(r.expiresAt)}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const revoke = trpc.borrowerInvites.revoke.useMutation({
    onSuccess: () => {
      setRevokeArmed(null);
      refreshInvites();
      toast.success("Invitation revoked — that link is dead for good");
    },
    onError: (e) => toast.error(e.message),
  });
  const setPortalStatus = trpc.borrowerInvites.setPortalStatus.useMutation({
    onSuccess: () => {
      refreshInvites();
      toast.success("Updated what the borrower sees");
    },
    onError: (e) => toast.error(e.message),
  });
  const createRequest = trpc.documentRequests.create.useMutation({
    onSuccess: () => {
      setNoteFor(null);
      setNote("");
      refreshRequests();
      toast.success("Request sent — the borrower sees it in their portal");
    },
    onError: (e) => toast.error(e.message),
  });
  const withdrawRequest = trpc.documentRequests.withdraw.useMutation({
    onSuccess: () => {
      refreshRequests();
      toast.success("Request withdrawn");
    },
    onError: (e) => toast.error(e.message),
  });

  const canWrite = WRITE_ROLES.includes(me.data?.role ?? "");
  const rows = invites.data ?? [];
  const isNewBorrower = borrowerId === "";
  const sending = createBorrower.isPending || createInvite.isPending;
  const composerReady = isNewBorrower
    ? fullName.trim().length > 0 && email.trim().includes("@")
    : true;

  /**
   * A borrower is a person the org knows, reused across deals — so a new one
   * is created first and the invite is minted against that id. Both mutations
   * report failure through this one catch; neither carries an onError.
   */
  async function sendInvitation() {
    try {
      let id = borrowerId;
      if (!id) {
        id = (await createBorrower.mutateAsync({ fullName: fullName.trim(), email: email.trim() }))
          .borrowerId;
        // Select them immediately: if minting the invite then fails, retrying
        // must not try to create the same person twice (unique email → 23505).
        setBorrowerId(id);
        void utils.borrowers.list.invalidate();
      }
      const entity = (entities.data ?? []).find((e) => e.id === entityId);
      await createInvite.mutateAsync({
        dealId,
        borrowerId: id,
        ...(entity ? { entityId: entity.id, entityLabel: entity.name } : {}),
        ...(displayLabel.trim() ? { displayLabel: displayLabel.trim() } : {}),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the invitation");
    }
  }

  return (
    <AppShell
      breadcrumb={deal.data?.name ?? "Deal"}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={`/deals/${dealId}/workspace`}>Back to workspace</Link>
        </Button>
      }
    >
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title="Borrower portal"
          description="Invite the borrower to a private, single-purpose portal — documents come in, nothing about the deal goes out."
        />

        {canWrite ? (
          <Card className="glass-card mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserPlus className="h-4 w-4 text-primary" />
                Invite a borrower
              </CardTitle>
              <CardDescription>
                Pick someone you have invited before, or add a new borrower — they are saved to your
                address book and reused on later deals.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="borrower-picker">Borrower</Label>
                <FieldSelect
                  ariaLabel="Borrower to invite"
                  value={borrowerId}
                  onChange={setBorrowerId}
                  placeholder="— add a new borrower —"
                  options={(borrowers.data ?? []).map((b) => ({
                    value: b.id,
                    label: `${b.fullName} · ${b.email}`,
                  }))}
                  size="default"
                  className="w-full"
                />
              </div>

              {isNewBorrower ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="borrower-name">Full name</Label>
                    <Input
                      id="borrower-name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Dana Reyes"
                      autoComplete="off"
                      className="bg-background/50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="borrower-email">Email</Label>
                    <Input
                      id="borrower-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="dana@sunrisemotel.com"
                      autoComplete="off"
                      className="bg-background/50"
                    />
                  </div>
                </div>
              ) : null}

              {(entities.data ?? []).length > 0 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="invite-entity">Entity (optional)</Label>
                  <FieldSelect
                    ariaLabel="Entity this borrower is sending documents for"
                    value={entityId}
                    onChange={setEntityId}
                    placeholder="— not entity-specific —"
                    options={(entities.data ?? []).map((e) => ({
                      value: e.id,
                      label: `${e.name} (${e.kind})`,
                    }))}
                    size="default"
                    className="w-full"
                  />
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="invite-label">What the borrower sees this deal called</Label>
                <Input
                  id="invite-label"
                  value={displayLabel}
                  onChange={(e) => setDisplayLabel(e.target.value)}
                  placeholder={deal.data?.name ?? "Deal name"}
                  className="bg-background/50"
                />
                <p className="text-xs text-muted-foreground">
                  Snapshotted at invite time. Renaming the deal later never changes what they see.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void sendInvitation()} disabled={sending || !composerReady}>
                  <span className="flex items-center gap-1.5">
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Send invitation
                  </span>
                </Button>
                <p className="text-xs text-muted-foreground">
                  The invitation lasts 30 days and asks for the standard checklist for this deal
                  type.
                </p>
              </div>

              {claimLink ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="mb-2 text-xs font-medium text-foreground">
                    This link is shown once. Copy it now — we only ever store its fingerprint, so a
                    lost link has to be re-issued as a new invitation.
                  </p>
                  <div className="flex items-center gap-2 rounded-md bg-muted p-2.5">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs">{claimLink}</code>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(claimLink);
                        toast.success("Link copied");
                      }}
                    >
                      <Copy className="h-3 w-3" />
                      Copy
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <section aria-labelledby="invitations-heading" className="space-y-3">
          <h2 id="invitations-heading" className="text-sm font-semibold">
            Invitations ({rows.length})
          </h2>

          {invites.error ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-severity-critical/30 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical"
            >
              <Ban className="h-4 w-4 shrink-0" />
              {invites.error.message}
            </div>
          ) : null}

          {invites.isLoading ? (
            <div className="glass-card flex items-center justify-center rounded-xl py-16">
              <div className="grid-loader">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              as="h3"
              icon={Users}
              title="No borrower invitations yet"
              description="Invite the borrower and they get their own portal: the checklist you asked for, a place to upload, and nothing else about this deal."
            />
          ) : (
            rows.map((i) => {
              const status: StatusChip = STATUS_LABEL[i.status] ?? {
                label: i.status,
                variant: "outline",
              };
              const dead = i.status === "revoked";
              const open = (requests.data ?? []).filter(
                (r) => r.inviteId === i.id && r.status === "open",
              );
              return (
                /* One DOM per invitation that reflows from a row at md+ to a
                   stack at 375px — a separate mobile card would duplicate every
                   button's accessible name. */
                <article
                  key={i.id}
                  className="glass-card rounded-xl border border-border p-3.5 sm:p-4"
                >
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {i.borrowerName ?? i.email}
                        {i.entityLabel ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {i.entityLabel}
                          </span>
                        ) : null}
                      </p>
                      <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        <Mail className="h-3 w-3 shrink-0" />
                        {i.email}
                      </p>
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>

                  <dl className="mt-2.5 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                    <div className="flex gap-1.5">
                      <dt className="font-medium text-foreground">Claimed</dt>
                      <dd>{i.claimedAt ? shortDate(i.claimedAt) : "not yet"}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="font-medium text-foreground">
                        {dead ? "Revoked" : "Expires"}
                      </dt>
                      <dd>
                        {dead
                          ? i.revokedAt
                            ? shortDate(i.revokedAt)
                            : "—"
                          : shortDate(i.expiresAt)}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="font-medium text-foreground">Asked for</dt>
                      <dd>
                        {i.requestedItems.length}{" "}
                        {i.requestedItems.length === 1 ? "document" : "documents"}
                      </dd>
                    </div>
                  </dl>

                  {i.lastRemindedAt ? (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarClock className="h-3 w-3" />
                      Last reminded {shortDate(i.lastRemindedAt)}
                    </p>
                  ) : null}

                  {open.length > 0 ? (
                    <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
                      {open.map((r) => (
                        <li key={r.id} className="flex items-start gap-2">
                          <MessageSquarePlus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                          <p className="min-w-0 flex-1 text-xs text-foreground">{r.note}</p>
                          {canWrite ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              className="text-muted-foreground"
                              disabled={withdrawRequest.isPending}
                              onClick={() => withdrawRequest.mutate({ requestId: r.id })}
                            >
                              Withdraw
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {/* A revoked invitation is terminal (0026 blocks resurrection),
                      so it offers nothing but its record. */}
                  {canWrite && !dead ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                      {/* Three-valued, not a one-shot "mark complete" button:
                          portal status is reversible (unlike revoke) and is the
                          ONLY status a borrower ever sees — deals.status must
                          never reach them. */}
                      <FieldSelect
                        ariaLabel={`What the borrower sees for ${i.email}`}
                        value={i.portalStatus}
                        onChange={(v) =>
                          setPortalStatus.mutate({
                            inviteId: i.id,
                            portalStatus: v as (typeof PORTAL_STATUS)[number]["value"],
                          })
                        }
                        options={PORTAL_STATUS.map((p) => ({ value: p.value, label: p.label }))}
                        disabled={setPortalStatus.isPending}
                      />
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={extend.isPending}
                        onClick={() => extend.mutate({ inviteId: i.id, days: 30 })}
                      >
                        <CalendarClock className="h-3 w-3" />
                        Extend 30 days
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setNoteFor(noteFor === i.id ? null : i.id);
                          setNote("");
                        }}
                      >
                        <MessageSquarePlus className="h-3 w-3" />
                        Request documents
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => setRevokeArmed(revokeArmed === i.id ? null : i.id)}
                      >
                        <Ban className="h-3 w-3" />
                        Revoke
                      </Button>
                    </div>
                  ) : null}

                  {canWrite && !dead && noteFor === i.id ? (
                    <div className="mt-3 space-y-1.5 rounded-lg border border-border/60 bg-muted/40 p-3">
                      <Label htmlFor={`note-${i.id}`}>
                        Ask {i.borrowerName ?? i.email} for a document
                      </Label>
                      <textarea
                        id={`note-${i.id}`}
                        rows={3}
                        maxLength={500}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Could you also send the 2024 rent roll?"
                        className={TEXTAREA_CLASS}
                      />
                      <p className="text-xs text-muted-foreground">
                        The borrower reads this text exactly as you write it, in their portal. Keep
                        it about the document — nothing internal.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          disabled={createRequest.isPending || note.trim().length === 0}
                          onClick={() =>
                            createRequest.mutate({ dealId, inviteId: i.id, note: note.trim() })
                          }
                        >
                          <span className="flex items-center gap-1.5">
                            {createRequest.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            Send request
                          </span>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setNoteFor(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {canWrite && !dead && revokeArmed === i.id ? (
                    <div
                      role="alert"
                      className="mt-3 space-y-2 rounded-lg border border-severity-critical/30 bg-severity-critical/10 p-3"
                    >
                      <p className="text-xs text-foreground">
                        Revoking is permanent and cannot be undone. The borrower&apos;s link stops
                        working immediately, their portal access ends, and nothing restores it — you
                        would have to send a brand-new invitation. Documents they already uploaded
                        stay on the deal.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate({ inviteId: i.id })}
                        >
                          <span className="flex items-center gap-1.5">
                            {revoke.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Revoke permanently
                          </span>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRevokeArmed(null)}>
                          Keep invitation
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </section>
      </main>
    </AppShell>
  );
}
