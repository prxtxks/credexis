"use client";

/**
 * Audit log viewer (m12-3-audit-viewer, plan 01 §5 step 4).
 *
 * A DENSE TABLE, deliberately — not cards. Plan §1.10: a card is the shape
 * the app reaches for when it has no other vocabulary, and an audit trail is
 * the canonical tabular object. Below `md` the same table scrolls
 * horizontally inside `<Table>`'s own container and drops two identifier
 * columns; there is no second mobile component tree (plan §7 rule 9).
 *
 * The client RENDERS (Iron Law #3): every value on this screen — including
 * everything inside `before`/`after` — arrives as a string from the server
 * and is never re-formatted, re-scaled or re-computed here.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronRight, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
/** Every rendered column, including the ones hidden below `md`. */
const COLUMN_COUNT = 7;

/**
 * Whitespace-only pretty printer for the raw JSON text of an audited row.
 *
 * It must never `JSON.parse`: parsing turns every `value_cents` bigint in
 * the payload into a JS number (Iron Law #2), and re-serializing would
 * rewrite the exact record the log exists to preserve. This walks the text
 * and inserts newlines/indentation between structural tokens, dropping only
 * whitespace that sits OUTSIDE strings — so every value, money included,
 * renders precisely as Postgres stored it.
 */
function indentJsonText(text: string): string {
  let out = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  const wrap = (d: number) => `\n${"  ".repeat(d)}`;

  for (const ch of text) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "{" || ch === "[") {
      depth += 1;
      out += ch + wrap(depth);
    } else if (ch === "}" || ch === "]") {
      // Clamped: malformed text must degrade to ugly, never throw.
      depth = Math.max(0, depth - 1);
      out += wrap(depth) + ch;
    } else if (ch === ",") {
      out += ch + wrap(depth);
    } else if (ch === ":") {
      out += ": ";
    } else if (ch !== " " && ch !== "\n" && ch !== "\t" && ch !== "\r") {
      out += ch;
    }
  }
  return out;
}

function PayloadPane({
  label,
  absent,
  text,
}: {
  label: string;
  /** What a null payload means on this side — an insert has no before, a delete no after. */
  absent: string;
  text: string | null;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      {text === null ? (
        <p className="text-[13px] text-muted-foreground">none — {absent}</p>
      ) : (
        <pre className="max-h-80 overflow-auto rounded-lg bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
          {indentJsonText(text)}
        </pre>
      )}
    </div>
  );
}

function ChainBanner() {
  // verify_audit_chain() rehashes every row in the tenant, so this is a full
  // table walk — cheap at pilot scale, but not something to refire on every
  // remount of this screen.
  const chain = trpc.audit.verifyChain.useQuery(undefined, { staleTime: 60_000 });

  const state = chain.isLoading
    ? "checking"
    : chain.error || !chain.data
      ? "unknown"
      : chain.data.intact
        ? "intact"
        : "broken";

  const Icon = state === "intact" ? ShieldCheck : state === "broken" ? ShieldAlert : ShieldQuestion;

  return (
    <section
      aria-label="hash chain status"
      className="glass-card mb-5 flex gap-3 rounded-xl p-4"
      // No emerald wash on the surface: status lives in the glyph and the
      // sentence, never in a colored panel (design language §2 Color).
    >
      <Icon
        className={cn(
          "mt-0.5 h-5 w-5 shrink-0",
          state === "intact" && "text-primary",
          state === "broken" && "text-severity-critical",
          (state === "checking" || state === "unknown") && "text-muted-foreground",
        )}
      />
      <div className="min-w-0 space-y-1.5">
        <p className="text-[15px] font-semibold">
          {state === "checking" && "Verifying the hash chain…"}
          {state === "intact" && "Hash chain intact"}
          {state === "broken" && `Hash chain broken at entry ${chain.data?.brokenAt ?? "?"}`}
          {state === "unknown" && "Hash chain could not be verified"}
        </p>
        {state === "broken" && chain.data?.reason ? (
          <p className="text-[13px] text-severity-critical">{chain.data.reason}</p>
        ) : null}
        {state === "unknown" && chain.error ? (
          <p className="text-[13px] text-muted-foreground">{chain.error.message}</p>
        ) : null}

        {/*
          Verbatim from 0024_audit-hash-chain.sql:10-15. This paragraph is
          the same size and colour as the status line on purpose: a reader
          who sees "intact" must not walk away believing the pre-0024 period
          was verified. Marketing does not get to round this up.
        */}
        <p className="text-[13px] text-foreground/80">
          Rows written before the chain was installed (migration 0024) were backfilled so the chain
          is contiguous — but a backfilled hash attests to the row as it exists <em>now</em>, not to
          what was written then. Tamper evidence is meaningful only from that migration forward; the
          earlier period is <strong className="font-semibold">not verified</strong>.
        </p>
        <p className="text-[13px] text-muted-foreground">
          Every member of this workspace can read this log — that is today&apos;s row-level security
          policy, not an oversight of this screen.
        </p>
      </div>
    </section>
  );
}

export default function AuditClient() {
  const [actorId, setActorId] = useState("");
  const [action, setAction] = useState("");
  const [tableName, setTableName] = useState("");
  const [since, setSince] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const members = trpc.members.list.useQuery();

  const log = trpc.audit.list.useInfiniteQuery(
    {
      limit: PAGE_SIZE,
      ...(actorId === "" ? {} : { actorId }),
      ...(action === "" ? {} : { action }),
      ...(tableName === "" ? {} : { tableName }),
      ...(since === "" ? {} : { since }),
    },
    { getNextPageParam: (last) => last.nextCursor },
  );

  const entries = useMemo(
    () => (log.data?.pages ?? []).flatMap((p) => p.entries),
    [log.data?.pages],
  );

  /**
   * Actor uuid → the name a human recognises. `members.list` is the tenant's
   * roster read through the same RLS, so an actor who has left the workspace
   * simply falls back to their uuid rather than vanishing.
   */
  const actorLabel = useMemo(() => {
    const byId = new Map((members.data ?? []).map((m) => [m.id, m.fullName ?? m.email]));
    return (id: string | null) => (id === null ? null : (byId.get(id) ?? id));
  }, [members.data]);

  /**
   * Filter choices come from the rows this tenant has actually produced. A
   * hardcoded list would rot the day someone adds an audit trigger (there
   * are twelve today), and the vocabulary only ever GROWS — otherwise
   * picking "UPDATE" would collapse the menu to "UPDATE" and strand you.
   */
  const [vocabulary, setVocabulary] = useState<{ actions: string[]; tables: string[] }>({
    actions: [],
    tables: [],
  });
  useEffect(() => {
    if (entries.length === 0) return;
    setVocabulary((prev) => {
      const actions = new Set(prev.actions);
      const tables = new Set(prev.tables);
      for (const e of entries) {
        actions.add(e.action);
        tables.add(e.tableName);
      }
      if (actions.size === prev.actions.length && tables.size === prev.tables.length) return prev;
      return { actions: [...actions].sort(), tables: [...tables].sort() };
    });
  }, [entries]);

  const showingEmpty = !log.isLoading && entries.length === 0;

  return (
    <AppShell breadcrumb="Audit log">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title="Audit log"
          description="Every recorded change, with the actor, the timestamp, and the exact row before and after."
        />

        <ChainBanner />

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <FieldSelect
            ariaLabel="Filter by actor"
            value={actorId}
            onChange={setActorId}
            placeholder="Any actor"
            options={(members.data ?? []).map((m) => ({
              value: m.id,
              label: m.fullName ?? m.email,
            }))}
          />
          <FieldSelect
            ariaLabel="Filter by action"
            value={action}
            onChange={setAction}
            placeholder="Any action"
            options={vocabulary.actions.map((a) => ({ value: a, label: a }))}
          />
          <FieldSelect
            ariaLabel="Filter by table"
            value={tableName}
            onChange={setTableName}
            placeholder="Any table"
            options={vocabulary.tables.map((t) => ({ value: t, label: t }))}
          />
          <Input
            type="date"
            aria-label="Show entries on or after (UTC)"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="h-8 w-auto text-[13px]"
          />
          {actorId || action || tableName || since ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setActorId("");
                setAction("");
                setTableName("");
                setSince("");
              }}
            >
              <span>Clear filters</span>
            </Button>
          ) : null}
        </div>

        {log.isLoading ? (
          <div className="glass-card space-y-2 rounded-xl p-3">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : log.error ? (
          // An unreadable log must never render as an empty one — "no entries"
          // and "we could not read the entries" are opposite claims.
          <section className="glass-card rounded-xl p-4">
            <p className="text-[15px] font-semibold text-severity-critical">
              Audit log could not be read
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">{log.error.message}</p>
          </section>
        ) : showingEmpty ? (
          <EmptyState
            title="No audit entries"
            description="Entries appear the moment someone overrides a fact, accepts an add-back, changes a scenario, or a member's access changes."
          />
        ) : (
          <div className="glass-card overflow-hidden rounded-xl p-2">
            <Table aria-label="Audit entries" className="text-[13px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Table</TableHead>
                  <TableHead className="hidden md:table-cell">Row</TableHead>
                  <TableHead className="hidden md:table-cell">Row hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
                  const open = expanded === e.id;
                  const who = actorLabel(e.actorId);
                  return (
                    <Fragment key={e.id}>
                      <TableRow>
                        <TableCell className="p-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-expanded={open}
                            aria-controls={`audit-detail-${e.id}`}
                            aria-label={`${open ? "Hide" : "Show"} details for audit entry ${e.id}`}
                            onClick={() => setExpanded(open ? null : e.id)}
                          >
                            <ChevronRight
                              className={cn(
                                "transition-transform duration-150",
                                open && "rotate-90",
                              )}
                            />
                          </Button>
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {new Date(e.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="max-w-40 truncate">
                          {who ?? (
                            <span
                              className="text-muted-foreground"
                              title="No signed-in actor — a pipeline worker or database connection wrote this row"
                            >
                              System
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={e.action === "DELETE" ? "destructive" : "secondary"}>
                            {e.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-[11px]">{e.tableName}</TableCell>
                        <TableCell className="hidden font-mono text-[11px] text-muted-foreground md:table-cell">
                          {e.rowId}
                        </TableCell>
                        <TableCell className="hidden font-mono text-[11px] text-muted-foreground md:table-cell">
                          {e.rowHash === null ? "—" : `${e.rowHash.slice(0, 12)}…`}
                        </TableCell>
                      </TableRow>
                      {open ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={COLUMN_COUNT} id={`audit-detail-${e.id}`}>
                            <div className="grid gap-4 md:grid-cols-2">
                              <PayloadPane
                                label="Before"
                                absent="the row did not exist yet"
                                text={e.before}
                              />
                              <PayloadPane
                                label="After"
                                absent="the row was deleted"
                                text={e.after}
                              />
                            </div>
                            <dl className="mt-3 grid gap-1 font-mono text-[11px] break-all text-muted-foreground">
                              <div className="flex gap-2">
                                <dt className="shrink-0">entry</dt>
                                <dd>{e.id}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="shrink-0">row</dt>
                                <dd>{e.rowId}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="shrink-0">prev_hash</dt>
                                <dd>{e.prevHash ?? "—"}</dd>
                              </div>
                              <div className="flex gap-2">
                                <dt className="shrink-0">row_hash</dt>
                                <dd>{e.rowHash ?? "—"}</dd>
                              </div>
                            </dl>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {log.hasNextPage ? (
          <div className="mt-3 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              disabled={log.isFetchingNextPage}
              onClick={() => void log.fetchNextPage()}
            >
              <span>{log.isFetchingNextPage ? "Loading…" : "Load older entries"}</span>
            </Button>
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}
