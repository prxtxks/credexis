/**
 * Taxonomy growth ledger (ADR-0004): the standing input to the periodic
 * "should the vocabulary grow?" review. Aggregates unmapped statement
 * labels from extraction run logs - a label recurring across ≥2 distinct
 * documents is a candidate node; everything else is noise the review
 * queue already owns. Read-only: growth itself happens in code
 * (packages/schema seed) through a human gate, never from the app.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../init";

interface LedgerRow {
  label: string;
  runs: number;
  documentIds: Set<string>;
  dealIds: Set<string>;
  lastSeen: string;
}

export const taxonomyRouter = router({
  /** Unmapped-label ledger over recent extract_statement runs. */
  unmappedLedger: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).default({ limit: 50 }))
    .query(async ({ ctx, input }) => {
      // Recent window keeps the scan bounded; RLS scopes to the tenant.
      const { data, error } = await ctx.supabase
        .from("extraction_runs")
        .select("deal_id, document_id, metadata, created_at")
        .eq("stage", "extract_statement")
        .eq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      const byLabel = new Map<string, LedgerRow>();
      for (const run of data ?? []) {
        const meta = run.metadata as { unmappedLabels?: unknown } | null;
        const labels = Array.isArray(meta?.unmappedLabels) ? meta.unmappedLabels : [];
        for (const raw of labels) {
          if (typeof raw !== "string" || raw.trim() === "") continue;
          const label = raw.trim();
          const row = byLabel.get(label) ?? {
            label,
            runs: 0,
            documentIds: new Set<string>(),
            dealIds: new Set<string>(),
            lastSeen: run.created_at as string,
          };
          row.runs += 1;
          row.documentIds.add(run.document_id as string);
          row.dealIds.add(run.deal_id as string);
          if ((run.created_at as string) > row.lastSeen) row.lastSeen = run.created_at as string;
          byLabel.set(label, row);
        }
      }

      // Candidates first (≥2 distinct documents, per ADR-0004), then by
      // spread and volume.
      const rows = [...byLabel.values()]
        .sort(
          (a, b) =>
            b.documentIds.size - a.documentIds.size ||
            b.dealIds.size - a.dealIds.size ||
            b.runs - a.runs,
        )
        .slice(0, input.limit)
        .map((r) => ({
          label: r.label,
          runs: r.runs,
          documents: r.documentIds.size,
          deals: r.dealIds.size,
          lastSeen: r.lastSeen,
          candidate: r.documentIds.size >= 2,
        }));
      return { rows, scannedRuns: (data ?? []).length };
    }),
});
