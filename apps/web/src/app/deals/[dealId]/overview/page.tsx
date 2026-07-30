"use client";

/**
 * Deal Overview (ui-17-deal-scope, 02-VERCEL-DERIVATION §4): the deal's
 * front page, shaped like the reference's project overview — a state hero,
 * the checklist widget (completed rows fill + strike, exactly the
 * Production Checklist pattern), extraction and validation widgets, and
 * recent documents.
 *
 * Every number is server truth: deals.get/board, pipeline.costs,
 * issues.forDeal, documents.list. Checklist completion is set membership
 * over fetched rows (selection, not metric math — Iron Law #3).
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowUpRight, Check, Download, FileText } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { checklistFor } from "@/lib/doc-checklist";
import { formatMicroUsd, formatRatio } from "@/lib/money-display";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  intake: "Intake",
  parsing: "Parsing",
  review: "In review",
  complete: "Complete",
};

const STATUS_DOT: Record<string, string> = {
  intake: "bg-muted-foreground/60",
  parsing: "bg-severity-warning",
  review: "bg-primary",
  complete: "bg-primary/50",
};

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
}

export default function DealOverviewPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;

  const deal = trpc.deals.get.useQuery({ dealId });
  const board = trpc.deals.board.useQuery();
  const docs = trpc.documents.list.useQuery({ dealId });
  const issues = trpc.issues.forDeal.useQuery({ dealId });
  const costs = trpc.pipeline.costs.useQuery(undefined, { staleTime: 60_000 });

  const boardRow = board.data?.find((d) => d.id === dealId);
  const costRow = costs.data?.find((c) => c.dealId === dealId);
  const checklist = deal.data ? checklistFor(deal.data.type) : [];
  const families = boardRow?.formFamilies ?? [];

  // issues.forDeal returns open issues only (the router filters server-side).
  const issuesByGate = new Map<string, number>();
  for (const i of issues.data ?? []) {
    issuesByGate.set(i.gate, (issuesByGate.get(i.gate) ?? 0) + 1);
  }

  return (
    <AppShell
      breadcrumb={deal.data?.name ?? "…"}
      actions={
        <Button asChild size="sm" className="max-md:hidden">
          <Link href={`/deals/${dealId}/workspace`}>
            <span className="flex items-center gap-1.5">Open workspace</span>
          </Link>
        </Button>
      }
    >
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {/* ── State hero ── */}
        <section className="glass-card rounded-xl">
          <div className="border-border/70 flex items-center justify-between gap-3 border-b px-5 py-3.5">
            <h1 className="text-heading">Underwriting state</h1>
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={`/api/deals/${dealId}/export`}>
                  <span className="flex items-center gap-1.5">
                    <Download className="size-3.5" />
                    XLSX
                  </span>
                </a>
              </Button>
              <Button asChild size="sm" className="md:hidden">
                <Link href={`/deals/${dealId}/workspace`}>Open workspace</Link>
              </Button>
            </div>
          </div>
          <div className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-muted-foreground text-[13px]">Status</p>
              {deal.data ? (
                <p className="mt-1 flex items-center gap-2 text-[15px] font-semibold">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 rounded-full",
                      STATUS_DOT[deal.data.status] ?? "bg-border",
                    )}
                  />
                  {STATUS_LABEL[deal.data.status] ?? deal.data.status}
                </p>
              ) : (
                <Skeleton className="mt-1 h-5 w-24" />
              )}
            </div>
            <div>
              <p className="text-muted-foreground text-[13px]">DSCR (business)</p>
              {board.isLoading ? (
                <Skeleton className="mt-1 h-5 w-16" />
              ) : boardRow?.dscr ? (
                <p className="mt-1 text-[15px] font-semibold tabular-nums">
                  {formatRatio(boardRow.dscr.mantissa, boardRow.dscr.scale)}×{" "}
                  <span className="text-muted-foreground text-[11px] font-normal">
                    {boardRow.dscr.period}
                  </span>
                </p>
              ) : (
                <p className="text-muted-foreground mt-1 text-[13px]">No engine run yet</p>
              )}
            </div>
            <div>
              <p className="text-muted-foreground text-[13px]">Type</p>
              {deal.data ? (
                <p className="mt-1 text-[15px] font-medium">
                  {deal.data.type.replaceAll("_", " ")}
                </p>
              ) : (
                <Skeleton className="mt-1 h-5 w-28" />
              )}
            </div>
            <div>
              <p className="text-muted-foreground text-[13px]">Last activity</p>
              {boardRow ? (
                <p className="mt-1 text-[15px] font-medium">{relativeTime(boardRow.updatedAt)}</p>
              ) : (
                <Skeleton className="mt-1 h-5 w-16" />
              )}
            </div>
          </div>
        </section>

        {/* ── Widgets ── */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Checklist — the reference's Production Checklist pattern */}
          <section className="glass-card rounded-xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-heading">Document checklist</h2>
              <span className="text-muted-foreground text-[13px] tabular-nums">
                {checklist.filter((c) => c.formFamilies.some((f) => families.includes(f))).length}/
                {checklist.length}
              </span>
            </div>
            <ul className="space-y-1">
              {checklist.map((c) => {
                const done = c.formFamilies.some((f) => families.includes(f));
                return (
                  <li key={c.label}>
                    <Link
                      href={`/deals/${dealId}/documents`}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-150",
                        done
                          ? "bg-primary/15 text-foreground/70 line-through decoration-foreground/30"
                          : "hover:bg-accent/50",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-full border",
                          done ? "border-primary/50 bg-primary/80" : "border-border",
                        )}
                      >
                        {done ? (
                          <Check
                            aria-hidden="true"
                            className="size-2.5 text-white"
                            strokeWidth={3}
                          />
                        ) : null}
                      </span>
                      {c.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Extraction — real pipeline totals for this deal */}
          <section className="glass-card rounded-xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-heading">Extraction</h2>
              <Link
                href="/costs"
                className="text-muted-foreground hover:text-foreground transition-colors duration-150"
                aria-label="All extraction costs"
              >
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
            {costs.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : costRow ? (
              <dl className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Runs</dt>
                  <dd className="font-medium tabular-nums">
                    {costRow.runs}
                    {costRow.failedRuns > 0 ? (
                      <span className="text-severity-warning"> · {costRow.failedRuns} failed</span>
                    ) : null}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Pages read</dt>
                  <dd className="font-medium tabular-nums">{costRow.pages}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Spend</dt>
                  <dd
                    className={cn(
                      "font-medium tabular-nums",
                      costRow.overEnvelope && "text-severity-warning",
                    )}
                  >
                    {formatMicroUsd(costRow.totalMicroUsd)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-muted-foreground text-[13px]">
                No extraction runs yet — upload documents and the pipeline totals land here.
              </p>
            )}
          </section>

          {/* Validation — open issues by gate */}
          <section className="glass-card rounded-xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-heading">Validation</h2>
              <Link
                href={`/deals/${dealId}/review`}
                className="text-muted-foreground hover:text-foreground transition-colors duration-150"
                aria-label="Open review queue"
              >
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
            {issues.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : issuesByGate.size === 0 ? (
              <p className="text-muted-foreground text-[13px]">
                No open gate violations — fields auto-accept when their gates pass.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {[...issuesByGate.entries()].map(([gate, count]) => (
                  <li key={gate} className="flex justify-between">
                    <span className="text-muted-foreground">Gate {gate}</span>
                    <Pill tone="warn">
                      <span className="tabular-nums">{count}</span> open
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── Recent documents ── */}
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-heading">Recent documents</h2>
            <Link
              href={`/deals/${dealId}/documents`}
              className="text-muted-foreground hover:text-foreground text-[13px] transition-colors duration-150"
            >
              All documents →
            </Link>
          </div>
          {docs.isLoading ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : (docs.data?.length ?? 0) === 0 ? (
            <div className="glass-card flex flex-col items-center rounded-xl px-6 py-10 text-center">
              <span className="border-border bg-popover flex size-10 items-center justify-center rounded-[10px] border">
                <FileText aria-hidden="true" className="text-muted-foreground size-4" />
              </span>
              <p className="mt-3 text-[15px] font-semibold">No documents yet</p>
              <p className="text-muted-foreground mt-1 max-w-sm text-[13px]">
                Upload returns and statements, or invite the borrower to send them.
              </p>
              <div className="mt-4 flex gap-2">
                <Button asChild size="sm">
                  <Link href={`/deals/${dealId}/documents`}>Upload documents</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/deals/${dealId}/borrower`}>Invite borrower</Link>
                </Button>
              </div>
            </div>
          ) : (
            <ul className="glass-card divide-border/70 divide-y rounded-xl">
              {(docs.data ?? []).slice(0, 5).map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/deals/${dealId}/documents`}
                    className="hover:bg-accent/40 flex items-center gap-3 px-4 py-3 transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl"
                  >
                    <FileText
                      aria-hidden="true"
                      className="text-muted-foreground size-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {d.fileName}
                    </span>
                    <Pill tone={d.status === "failed" ? "warn" : "neutral"} className="shrink-0">
                      {d.status}
                    </Pill>
                    <span className="text-muted-foreground shrink-0 text-[11px]">
                      {relativeTime(d.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AppShell>
  );
}
