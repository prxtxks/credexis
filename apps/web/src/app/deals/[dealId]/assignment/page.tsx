"use client";

/**
 * Document assignment (M6.5): confirm/fix the split & entity suggestions
 * Stage-S made. Every save is one audited mutation; the client renders
 * server truth and edits labels - it never computes (Iron Law #3).
 *
 * V1 restyle (ui-3): mounted under the app shell top bar (back → workspace,
 * breadcrumb = deal name) over the gradient mesh; the picker table lives in a
 * glass Card using the shadcn Table primitives. Native <select>s keep the
 * draft/save behavior byte-for-byte and avoid Radix-portal test flakiness.
 */

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, Check, FileText, Loader2, Merge, Scissors, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { ASSIGNABLE_FAMILIES } from "@/lib/form-families";
import { AppShell } from "@/components/app-shell";
import { DealNotFoundPanel, isDealNotFound } from "@/components/deal-not-found";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PageLoading } from "@/components/ui/page-loading";

export default function AssignmentPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const utils = trpc.useUtils();
  const deal = trpc.deals.get.useQuery(
    { dealId },
    // NOT_FOUND is deterministic (row absent or RLS-hidden) - retrying
    // only delays the terminal not-found state.
    { retry: (count, err) => !isDealNotFound(err) && count < 3 },
  );
  const list = trpc.assignment.list.useQuery({ dealId });
  // M11.6: printed-name identity matches per logical document.
  const identities = trpc.identities.forDeal.useQuery({ dealId });
  const decideIdentity = trpc.identities.decide.useMutation({
    onSuccess: () => void utils.identities.forDeal.invalidate({ dealId }),
  });
  const entities = trpc.assignment.entities.useQuery({ dealId });
  const assign = trpc.assignment.assign.useMutation({
    onSuccess: (r) => {
      void utils.assignment.list.invalidate({ dealId });
      // M14.5: assigning an entity queues extraction for that span - say
      // so, because facts arriving a minute later would otherwise look
      // like magic (or, worse, like nothing happened).
      if (r.extractionQueued) toast.success("Entity assigned - extraction queued");
    },
    onError: (err) => toast.error(err.message),
  });
  // M13.5: reviewers own the page ranges too - edit and split, audited.
  const setPages = trpc.assignment.setPages.useMutation({
    onSuccess: () => {
      void utils.assignment.list.invalidate({ dealId });
      toast.success("Page range updated");
    },
    onError: (err) => toast.error(err.message),
  });
  const split = trpc.assignment.split.useMutation({
    onSuccess: () => {
      void utils.assignment.list.invalidate({ dealId });
      toast.success("Span split - relabel the new half");
    },
    onError: (err) => toast.error(err.message),
  });
  const merge = trpc.assignment.merge.useMutation({
    onSuccess: () => {
      void utils.assignment.list.invalidate({ dealId });
      toast.success("Spans joined");
    },
    onError: (err) => toast.error(err.message),
  });
  const [pageDrafts, setPageDrafts] = useState<Record<string, { start: string; end: string }>>({});
  const [splitDrafts, setSplitDrafts] = useState<Record<string, string>>({});

  type Row = NonNullable<typeof list.data>[number];
  const pagesDirty = (row: Row) => {
    const d = pageDrafts[row.id];
    return d !== undefined && (d.start !== String(row.pageStart) || d.end !== String(row.pageEnd));
  };
  const pagesValid = (row: Row) => {
    const d = pageDrafts[row.id];
    if (!d) return false;
    const s = Number(d.start);
    const e = Number(d.end);
    return d.start !== "" && d.end !== "" && s >= 1 && e >= s;
  };
  const splitValid = (row: Row) => {
    const v = splitDrafts[row.id];
    if (v === undefined || v === "") return false;
    const n = Number(v);
    return n > row.pageStart && n <= row.pageEnd;
  };
  const cancelSplit = (row: Row) =>
    setSplitDrafts((d) => {
      const next = { ...d };
      delete next[row.id];
      return next;
    });
  function submitSplit(row: Row) {
    if (!splitValid(row)) return;
    split.mutate(
      { logicalDocumentId: row.id, atPage: Number(splitDrafts[row.id]) },
      { onSuccess: () => cancelSplit(row) },
    );
  }
  function submitPages(row: Row) {
    if (!pagesDirty(row) || !pagesValid(row)) return;
    const d = pageDrafts[row.id]!;
    setPages.mutate(
      { logicalDocumentId: row.id, pageStart: Number(d.start), pageEnd: Number(d.end) },
      {
        onSuccess: () =>
          setPageDrafts((x) => {
            const next = { ...x };
            delete next[row.id];
            return next;
          }),
      },
    );
  }

  // Draft edits keyed by logical document id; unsaved fields only.
  const [drafts, setDrafts] = useState<
    Record<string, { formFamily?: string; taxYear?: string; entityId?: string }>
  >({});

  function setDraft(id: string, patch: Record<string, string>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  function save(row: NonNullable<typeof list.data>[number]) {
    const draft = drafts[row.id] ?? {};
    const input: {
      logicalDocumentId: string;
      formFamily?: string;
      taxYear?: number | null;
      entityId?: string | null;
    } = { logicalDocumentId: row.id };

    if (draft.formFamily !== undefined && draft.formFamily !== row.formFamily) {
      input.formFamily = draft.formFamily;
    }
    if (draft.taxYear !== undefined && draft.taxYear !== String(row.taxYear ?? "")) {
      input.taxYear = draft.taxYear === "" ? null : Number(draft.taxYear);
    }
    if (draft.entityId !== undefined && draft.entityId !== (row.entityId ?? "")) {
      input.entityId = draft.entityId === "" ? null : draft.entityId;
    } else if (draft.entityId === undefined && row.entityId && !row.entityConfirmed) {
      // Explicit "Confirm" of the suggested entity with no other edits.
      input.entityId = row.entityId;
    }

    assign.mutate(input, {
      onSuccess: () =>
        setDrafts((d) => {
          const next = { ...d };
          delete next[row.id];
          return next;
        }),
    });
  }

  // Terminal: an empty assignment table ("No logical documents yet") on a
  // deal the tenant cannot see reads as a real (empty) deal - render the
  // honest state instead.
  if (isDealNotFound(deal.error)) {
    return (
      <AppShell breadcrumb="Deal not found">
        <main className="mx-auto max-w-5xl px-4 py-24 sm:px-6 lg:px-8">
          <DealNotFoundPanel />
        </main>
      </AppShell>
    );
  }

  const rows = list.data ?? [];

  return (
    <AppShell
      breadcrumb={deal.data?.name ?? "Deal"}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={`/deals/${dealId}/workspace`}>Back to workspace</Link>
        </Button>
      }
    >
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <FileText className="h-5 w-5 text-primary" />
            Document assignment
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Confirm or fix what the splitter suggested. Every change is audited.
          </p>
        </div>

        {assign.error && (
          <div
            role="alert"
            className="mb-4 flex items-center gap-2 rounded-lg border border-severity-critical/30 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {assign.error.message}
          </div>
        )}

        {list.isLoading ? (
          <div className="glass-card flex items-center justify-center rounded-xl py-16">
            <PageLoading />
          </div>
        ) : (
          <div className="glass-card overflow-x-auto rounded-xl p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Pages</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Tax year</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => {
                  // The row above, when it is the immediately preceding
                  // span of the SAME file - the only legal merge partner.
                  const prev = rows[i - 1];
                  const mergeable =
                    prev && prev.documentId === row.documentId && prev.pageEnd + 1 === row.pageStart
                      ? prev
                      : null;
                  const draft = drafts[row.id] ?? {};
                  const family = draft.formFamily ?? row.formFamily;
                  const year = draft.taxYear ?? String(row.taxYear ?? "");
                  const entityId = draft.entityId ?? row.entityId ?? "";
                  const dirty = Object.keys(draft).length > 0;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {row.fileName}
                        {(identities.data ?? [])
                          .filter((i) => i.logicalDocumentId === row.id && i.state === "suggested")
                          .map((i) => (
                            <span
                              key={i.id}
                              className={cn(
                                "mt-1 flex items-center gap-1.5 text-[11px] font-normal",
                                i.band === "high"
                                  ? "text-primary"
                                  : i.band === "mid"
                                    ? "text-severity-warning"
                                    : "text-severity-critical",
                              )}
                            >
                              &ldquo;{i.extractedName}&rdquo; - matches{" "}
                              {Math.round(i.scoreBps / 100)}%
                              <button
                                className="underline underline-offset-2"
                                onClick={() =>
                                  decideIdentity.mutate({ identityId: i.id, state: "confirmed" })
                                }
                              >
                                approve
                              </button>
                              <button
                                className="text-muted-foreground underline underline-offset-2"
                                onClick={() =>
                                  decideIdentity.mutate({ identityId: i.id, state: "rejected" })
                                }
                              >
                                reject
                              </button>
                            </span>
                          ))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {/* Editable range + split (M13.5): if the splitter
                            drew a boundary wrong, the reviewer fixes it
                            here - every change audited like the labels. */}
                        <div className="flex items-center gap-1">
                          <Input
                            aria-label={`First page of the ${row.pageStart}-${row.pageEnd} span in ${row.fileName}`}
                            value={pageDrafts[row.id]?.start ?? String(row.pageStart)}
                            onChange={(e) =>
                              setPageDrafts((d) => ({
                                ...d,
                                [row.id]: {
                                  start: e.target.value.replace(/\D/g, ""),
                                  end: d[row.id]?.end ?? String(row.pageEnd),
                                },
                              }))
                            }
                            onKeyDown={(e) => e.key === "Enter" && submitPages(row)}
                            inputMode="numeric"
                            className="h-8 w-12 text-center tabular-nums"
                          />
                          <span className="text-muted-foreground">-</span>
                          <Input
                            aria-label={`Last page of the ${row.pageStart}-${row.pageEnd} span in ${row.fileName}`}
                            value={pageDrafts[row.id]?.end ?? String(row.pageEnd)}
                            onChange={(e) =>
                              setPageDrafts((d) => ({
                                ...d,
                                [row.id]: {
                                  start: d[row.id]?.start ?? String(row.pageStart),
                                  end: e.target.value.replace(/\D/g, ""),
                                },
                              }))
                            }
                            onKeyDown={(e) => e.key === "Enter" && submitPages(row)}
                            inputMode="numeric"
                            className="h-8 w-12 text-center tabular-nums"
                          />
                          {pagesDirty(row) ? (
                            <Button
                              size="xs"
                              variant="brand"
                              // Guard the empty/partial draft here: the server
                              // would answer a raw Zod blob, which is not a
                              // sentence an underwriter can act on.
                              disabled={setPages.isPending || !pagesValid(row)}
                              onClick={() => submitPages(row)}
                            >
                              Set
                            </Button>
                          ) : row.pageEnd > row.pageStart ? (
                            splitDrafts[row.id] !== undefined ? (
                              <span className="flex items-center gap-1">
                                <Input
                                  autoFocus
                                  aria-label={`Split the ${row.pageStart}-${row.pageEnd} span of ${row.fileName} at page`}
                                  value={splitDrafts[row.id]}
                                  onChange={(e) =>
                                    setSplitDrafts((d) => ({
                                      ...d,
                                      [row.id]: e.target.value.replace(/\D/g, ""),
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") submitSplit(row);
                                    if (e.key === "Escape") cancelSplit(row);
                                  }}
                                  placeholder={`${row.pageStart + 1}`}
                                  inputMode="numeric"
                                  className="h-8 w-12 text-center tabular-nums"
                                />
                                <Button
                                  size="xs"
                                  variant="brand"
                                  disabled={split.isPending || !splitValid(row)}
                                  onClick={() => submitSplit(row)}
                                >
                                  Split
                                </Button>
                                {/* An accidental scissors click must be
                                    escapable - Esc or this button. */}
                                <button
                                  type="button"
                                  aria-label={`Cancel splitting the ${row.pageStart}-${row.pageEnd} span`}
                                  onClick={() => cancelSplit(row)}
                                  className="hover:bg-accent text-muted-foreground rounded-md p-1 transition-colors"
                                >
                                  <X className="size-3.5" />
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                aria-label={`Split span ${row.pageStart}-${row.pageEnd} of ${row.fileName}`}
                                title="Split this span at a page"
                                onClick={() => setSplitDrafts((d) => ({ ...d, [row.id]: "" }))}
                                className="hover:bg-accent text-muted-foreground rounded-md p-1.5 transition-colors"
                              >
                                <Scissors className="size-3.5" />
                              </button>
                            )
                          ) : null}
                          {mergeable && splitDrafts[row.id] === undefined ? (
                            <button
                              type="button"
                              aria-label={`Join pages ${row.pageStart}-${row.pageEnd} into the ${mergeable.pageStart}-${mergeable.pageEnd} span`}
                              title={`Join with the span above (${mergeable.pageStart}-${mergeable.pageEnd})`}
                              disabled={merge.isPending}
                              onClick={() =>
                                merge.mutate({
                                  logicalDocumentId: row.id,
                                  intoLogicalDocumentId: mergeable.id,
                                })
                              }
                              className="hover:bg-accent text-muted-foreground rounded-md p-1.5 transition-colors"
                            >
                              <Merge className="size-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <FieldSelect
                          ariaLabel={`Form family for ${row.fileName}`}
                          value={family}
                          onChange={(v) => setDraft(row.id, { formFamily: v })}
                          options={ASSIGNABLE_FAMILIES.map((f) => ({ value: f, label: f }))}
                          className={cn(
                            family === "UNKNOWN" &&
                              "text-severity-warning ring-1 ring-severity-warning",
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={year}
                          onChange={(e) => setDraft(row.id, { taxYear: e.target.value })}
                          placeholder="-"
                          inputMode="numeric"
                          className="w-16"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FieldSelect
                            ariaLabel={`Entity for ${row.fileName}`}
                            value={entityId}
                            onChange={(v) => setDraft(row.id, { entityId: v })}
                            placeholder="- unassigned -"
                            options={(entities.data ?? []).map((e) => ({
                              value: e.id,
                              label: `${e.name} (${e.kind})`,
                            }))}
                          />
                          {row.entityConfirmed && !dirty && (
                            <span className="flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary">
                              <Check className="h-3.5 w-3.5" />✓ confirmed
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={dirty ? "default" : "outline"}
                          onClick={() => save(row)}
                          disabled={
                            assign.isPending || (!dirty && (row.entityConfirmed || !row.entityId))
                          }
                        >
                          {assign.isPending && (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          )}
                          {dirty ? "Save" : "Confirm"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No logical documents yet - they appear after uploads finish processing.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </AppShell>
  );
}
