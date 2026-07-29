"use client";

/**
 * Cost dashboard (M10.2): per-deal extraction spend from extraction_runs
 * — cost per deal is a KPI (Blueprint §12: ~$5–10 COGS envelope). Deals
 * over the envelope and failed runs are flagged; values render as
 * strings, aggregation happened server-side in exact integers.
 */

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
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
    <AppShell breadcrumb="Extraction costs">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-5">
          <h1 className="text-xl font-bold tracking-tight">Extraction costs</h1>
          <p className="text-sm text-muted-foreground">
            Per-deal spend across pipeline stages — envelope $10/deal.
          </p>
        </div>

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
