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
import { ThemeToggle } from "@/components/theme-toggle";

export default function CostsPage() {
  const costs = trpc.pipeline.costs.useQuery(undefined, { refetchInterval: 30_000 });

  return (
    <main className="gradient-mesh min-h-screen p-6">
      <header className="mb-6 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Extraction costs</h1>
        <Link href="/" className="text-sm text-primary underline dark:text-primary-dark">
          ← deals
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      {costs.isLoading ? (
        <p className="text-sm">Loading…</p>
      ) : (
        <div className="glass-card overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left dark:border-line-dark">
                <th className="p-2">Deal</th>
                <th className="p-2 text-right">Runs</th>
                <th className="p-2 text-right">Failed</th>
                <th className="p-2 text-right">Pages</th>
                <th className="p-2 text-right">Total cost</th>
                <th className="p-2">By stage</th>
              </tr>
            </thead>
            <tbody>
              {(costs.data ?? []).map((d) => (
                <tr key={d.dealId} className="border-b border-line/50 dark:border-line-dark/50">
                  <td className="p-2">
                    <Link
                      href={`/deals/${d.dealId}/workspace`}
                      className="text-primary underline dark:text-primary-dark"
                    >
                      {d.dealName}
                    </Link>
                  </td>
                  <td className="p-2 text-right tabular-nums">{d.runs}</td>
                  <td
                    className={`p-2 text-right tabular-nums ${d.failedRuns > 0 ? "font-semibold text-severity-critical" : ""}`}
                  >
                    {d.failedRuns}
                  </td>
                  <td className="p-2 text-right tabular-nums">{d.pages}</td>
                  <td
                    className={`p-2 text-right tabular-nums ${d.overEnvelope ? "font-semibold text-severity-critical" : ""}`}
                    title={d.overEnvelope ? "Over the $10 per-deal envelope (Blueprint §12)" : ""}
                  >
                    {formatMicroUsd(d.totalMicroUsd)}
                    {d.overEnvelope ? " ⚠" : ""}
                  </td>
                  <td className="p-2 text-xs text-ink-muted dark:text-ink-dark-muted">
                    {d.byStage.map((s) => `${s.stage} ${formatMicroUsd(s.microUsd)}`).join(" · ")}
                  </td>
                </tr>
              ))}
              {(costs.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-ink-muted dark:text-ink-dark-muted">
                    No extraction runs yet — costs appear once the pipeline processes documents.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
