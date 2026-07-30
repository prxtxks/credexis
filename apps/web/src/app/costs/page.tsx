"use client";

/**
 * Cost dashboard (M10.2): per-deal extraction spend from extraction_runs
 * — cost per deal is a KPI (Blueprint §12: ~$5–10 COGS envelope). Deals
 * over the envelope and failed runs are flagged; values render as
 * strings, aggregation happened server-side in exact integers.
 */

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatMicroUsd } from "@/lib/money-display";
import { AppShell } from "@/components/app-shell";
import { PageLoading } from "@/components/ui/page-loading";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function CostsPage() {
  const costs = trpc.pipeline.costs.useQuery(undefined, { refetchInterval: 30_000 });

  return (
    <AppShell breadcrumb="Usage">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-5">
          <h1 className="text-title">Usage</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            What this workspace consumes — live series, plan, and per-deal spend.
          </p>
        </div>

        <UsageCharts />

        <PlanCard />

        <h2 className="text-heading mt-8 mb-3">Per-deal spend</h2>

        {costs.isLoading ? (
          <div className="flex justify-center py-16">
            <PageLoading />
          </div>
        ) : (
          <div className="glass-card overflow-x-auto rounded-xl p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deal</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                  <TableHead className="text-right">Total cost</TableHead>
                  <TableHead>By stage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(costs.data ?? []).map((d) => (
                  <TableRow key={d.dealId}>
                    <TableCell>
                      <Link
                        href={`/deals/${d.dealId}/workspace`}
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        {d.dealName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{d.runs}</TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${d.failedRuns > 0 ? "font-semibold text-severity-critical" : ""}`}
                    >
                      {d.failedRuns}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{d.pages}</TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${d.overEnvelope ? "font-semibold text-severity-critical" : ""}`}
                      title={d.overEnvelope ? "Over the $10 per-deal envelope (Blueprint §12)" : ""}
                    >
                      {formatMicroUsd(d.totalMicroUsd)}
                      {d.overEnvelope ? " ⚠" : ""}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {d.byStage.map((s) => `${s.stage} ${formatMicroUsd(s.microUsd)}`).join(" · ")}
                    </TableCell>
                  </TableRow>
                ))}
                {(costs.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="p-4 text-muted-foreground">
                      No extraction runs yet — costs appear once the pipeline processes documents.
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

/**
 * 30-day usage charts (ui-19, reference Observability card anatomy): the
 * server aggregates per-day buckets (pipeline.usageSeries); these bars are
 * pure geometry over that series — the client never sums.
 */
function UsageCharts() {
  const series = trpc.pipeline.usageSeries.useQuery(undefined, { staleTime: 60_000 });
  const days = series.data ?? [];
  const totalMicro = days.reduce((a, d) => a + BigInt(d.microUsd), 0n);
  const totalPages = days.reduce((a, d) => a + d.pages, 0);
  const totalRuns = days.reduce((a, d) => a + d.runs, 0);
  const totalFailed = days.reduce((a, d) => a + d.failed, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Extraction spend"
        stat={series.isLoading ? null : formatMicroUsd(totalMicro.toString())}
        statLabel="last 30 days"
        values={days.map((d) => Number(BigInt(d.microUsd) / 1000n))}
        loading={series.isLoading}
      />
      <ChartCard
        title="Pages processed"
        stat={series.isLoading ? null : `${totalPages}`}
        statLabel={`${totalRuns} runs${totalFailed > 0 ? ` · ${totalFailed} failed` : ""}`}
        values={days.map((d) => d.pages)}
        loading={series.isLoading}
        warn={totalFailed > 0}
      />
    </div>
  );
}

function ChartCard({
  title,
  stat,
  statLabel,
  values,
  loading,
  warn,
}: {
  title: string;
  stat: string | null;
  statLabel: string;
  values: number[];
  loading: boolean;
  warn?: boolean;
}) {
  const max = Math.max(1, ...values);
  const W = 300;
  const H = 64;
  const bw = W / Math.max(1, values.length);
  return (
    <section className="glass-card rounded-lg p-4">
      <h3 className="text-heading">{title}</h3>
      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          <p className="mt-1">
            <span className="text-[22px] font-semibold tabular-nums">{stat}</span>{" "}
            <span
              className={cn(
                "text-[13px]",
                warn ? "text-severity-warning" : "text-muted-foreground",
              )}
            >
              {statLabel}
            </span>
          </p>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            aria-label={`${title}, daily, last 30 days`}
            className="mt-3 h-16 w-full"
          >
            {values.map((v, i) => {
              const h = Math.max(v > 0 ? 2 : 1, (v / max) * (H - 4));
              return (
                <rect
                  key={i}
                  x={i * bw + 1}
                  y={H - h}
                  width={Math.max(1, bw - 2)}
                  height={h}
                  rx={1}
                  className={v > 0 ? "fill-primary/80" : "fill-border"}
                />
              );
            })}
          </svg>
          <div className="text-muted-foreground mt-1 flex justify-between text-[11px]">
            <span>30d ago</span>
            <span>today</span>
          </div>
        </>
      )}
    </section>
  );
}

/** The Pilot plan card (moved from /settings/plan — feedback pass 3). */
function PlanCard() {
  const INCLUDED = [
    "Unlimited team members",
    "Dual-reader consensus extraction",
    "Blocking validation gates (G1–G6)",
    "Borrower portal with per-invite limits",
    "Tamper-evident audit trail",
    "Banker-grade XLSX exports",
  ];
  return (
    <section className="glass-card mt-6 rounded-lg p-5">
      <h2 className="text-heading">Pilot plan</h2>
      <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
        Every feature is included while Credexis is in pilot. Contract pricing arrives with billing
        — there is nothing to pay here yet.
      </p>
      <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {INCLUDED.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm">
            <span className="bg-primary/80 flex size-4 shrink-0 items-center justify-center rounded-full">
              <Check aria-hidden="true" className="size-2.5 text-white" strokeWidth={3} />
            </span>
            {f}
          </li>
        ))}
      </ul>
    </section>
  );
}
