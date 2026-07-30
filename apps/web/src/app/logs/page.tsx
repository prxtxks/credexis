"use client";

/**
 * Logs (ui-18, 02-VERCEL-DERIVATION §4): the org-wide pipeline run log,
 * derived from the reference's Logs page - toolbar filters over a dense
 * table, honest empty state. Data is REAL (`extraction_runs` via
 * pipeline.runs, RLS-scoped). Live tail is staged until a streaming
 * backend exists - the button says so.
 */

import { useState } from "react";
import Link from "next/link";
import { RadioTower, RefreshCw, ScrollText } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { AppShell } from "@/components/app-shell";
import { formatMicroUsd } from "@/lib/money-display";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  running: "text-severity-warning",
  succeeded: "text-primary",
  failed: "text-severity-critical",
};

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function LogsPage() {
  const [stage, setStage] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const utils = trpc.useUtils();
  const runs = trpc.pipeline.runs.useQuery({ limit: 100 });

  // Stage options come from the data itself - the pipeline's stage strings
  // are its own vocabulary; hardcoding a list here would drift.
  const stages = [...new Set((runs.data ?? []).map((r) => r.stage))].sort();
  const rows = (runs.data ?? []).filter(
    (r) => (stage === "all" || r.stage === stage) && (status === "all" || r.status === status),
  );

  return (
    <AppShell breadcrumb="Logs">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-title">Logs</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Every pipeline run across the workspace - stage, outcome, pages, and spend.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled className="text-muted-foreground gap-1.5">
              <RadioTower className="size-3.5" />
              Live
              <Pill tone="accent">Soon</Pill>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={runs.isFetching}
              onClick={() => void utils.pipeline.runs.invalidate()}
            >
              <span className="flex items-center gap-1.5">
                <RefreshCw className={cn("size-3.5", runs.isFetching && "animate-spin")} />
                Refresh
              </span>
            </Button>
          </div>
        </div>

        {/* ── Filters ── */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <FieldSelect
            ariaLabel="Filter by stage"
            value={stage}
            onChange={setStage}
            options={[
              { value: "all", label: "All stages" },
              ...stages.map((s) => ({ value: s, label: s })),
            ]}
            size="default"
          />
          <FieldSelect
            ariaLabel="Filter by status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All statuses" },
              { value: "running", label: "Running" },
              { value: "succeeded", label: "Succeeded" },
              { value: "failed", label: "Failed" },
            ]}
            size="default"
          />
        </div>

        {/* ── Table ── */}
        <div className="glass-card mt-4 overflow-x-auto rounded-lg">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-border/70 text-muted-foreground border-b text-left text-[13px]">
                <th className="px-4 py-2.5 font-normal">Time</th>
                <th className="px-4 py-2.5 font-normal">Deal</th>
                <th className="px-4 py-2.5 font-normal">Stage</th>
                <th className="px-4 py-2.5 font-normal">Status</th>
                <th className="px-4 py-2.5 text-right font-normal">Pages</th>
                <th className="px-4 py-2.5 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-border/70 divide-y">
              {runs.isLoading ? (
                [0, 1, 2, 3, 4, 5].map((i) => (
                  <tr key={i}>
                    <td className="px-4 py-3" colSpan={6}>
                      <Skeleton className="h-4" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="flex flex-col items-center px-6 py-14 text-center">
                      <span className="border-border bg-popover flex size-10 items-center justify-center rounded-[10px] border">
                        <ScrollText aria-hidden="true" className="text-muted-foreground size-4" />
                      </span>
                      <p className="mt-3 text-[15px] font-semibold">No runs match</p>
                      <p className="text-muted-foreground mt-1 max-w-sm text-[13px]">
                        Pipeline runs appear here as documents are processed - upload to a deal to
                        start one.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-accent/30 transition-colors duration-150">
                    <td className="text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                      {relativeTime(r.startedAt)}
                    </td>
                    <td className="max-w-56 truncate px-4 py-2.5 font-medium">
                      <Link
                        href={`/deals/${r.dealId}/overview`}
                        className="hover:text-primary transition-colors duration-150"
                      >
                        {r.dealName}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[13px]">{r.stage}</span>
                    </td>
                    <td className={cn("px-4 py-2.5 font-medium", STATUS_TONE[r.status])}>
                      {r.status}
                      {r.error ? (
                        <span className="text-muted-foreground ml-1.5 font-normal" title={r.error}>
                          - {r.error.slice(0, 40)}
                          {r.error.length > 40 ? "…" : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.pages ?? "-"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatMicroUsd(r.costMicroUsd)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground mt-2 text-[11px]">
          Newest 100 runs. Per-deal totals live in{" "}
          <Link href="/costs" className="hover:text-foreground underline underline-offset-2">
            Usage
          </Link>
          .
        </p>
      </main>
    </AppShell>
  );
}
