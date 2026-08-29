"use client";

/**
 * Settings → Taxonomy (ADR-0004): the unmapped-label ledger. Labels the
 * mapper refused to force-fit, aggregated across recent extraction runs.
 * A label recurring on 2+ distinct documents is a CANDIDATE for a new
 * taxonomy node - growth itself happens in code through a human gate
 * (see the ADR), so this page reads and recommends, never mutates.
 */

import { trpc } from "@/lib/trpc/client";
import { AppShell } from "@/components/app-shell";
import { SettingsCard } from "@/components/ui/settings-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function SettingsTaxonomyPage() {
  const q = trpc.taxonomy.unmappedLedger.useQuery({ limit: 100 });

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold">Taxonomy</h1>
          <p className="text-muted-foreground text-sm">
            Statement lines the system refused to guess a category for. A label seen on two or more
            documents is a candidate for a new category — growth is reviewed, versioned, and never
            automatic.
          </p>
        </div>

        <SettingsCard
          title="Unmapped-label ledger"
          description={
            q.data
              ? `Aggregated from the last ${q.data.scannedRuns} statement extractions.`
              : "Aggregated from recent statement extractions."
          }
        >
          {q.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : q.error ? (
            <p className="text-severity-warning p-4 text-sm">{q.error.message}</p>
          ) : (q.data?.rows.length ?? 0) === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">
              Nothing unmapped — every extracted statement line found a category or is waiting in
              the review queue.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border/70 text-muted-foreground border-b text-left text-[13px]">
                  <th className="px-4 py-2 font-normal">Printed label</th>
                  <th className="px-4 py-2 text-right font-normal">Documents</th>
                  <th className="px-4 py-2 text-right font-normal">Deals</th>
                  <th className="px-4 py-2 text-right font-normal">Occurrences</th>
                  <th className="px-4 py-2 font-normal">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-border/70 divide-y">
                {q.data?.rows.map((r) => (
                  <tr key={r.label}>
                    <td className="px-4 py-2">
                      <span className="font-medium">{r.label}</span>
                      {r.candidate ? (
                        <span
                          className={cn(
                            "bg-primary/10 text-primary ml-2 rounded-full px-2 py-0.5",
                            "text-[11px] font-semibold",
                          )}
                        >
                          candidate
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.documents}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.deals}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.runs}</td>
                    <td className="text-muted-foreground px-4 py-2">
                      {new Date(r.lastSeen).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SettingsCard>
      </div>
    </AppShell>
  );
}
