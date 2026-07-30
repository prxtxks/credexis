/**
 * Spread API (M8.3): taxonomy rows × period columns per entity, plus the
 * engine's computed rows (violet + SBA badge client-side). Inline label
 * rename teaches the taxonomy mapper via learned_mappings.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { listRegistryEntries } from "@credexis/extraction";
import { protectedProcedure, router, underwriterProcedure } from "../init";
import {
  assembleSpread,
  normalizeLabel,
  type SpreadFactRow,
  type TaxonomyNodeRow,
} from "../../spread/logic";
import { assembleTaxSpread, type RegistryRowMeta, type TaxFactRow } from "../../spread/tax-logic";

/** Tab → taxonomy key prefix. Tax/Pro-Forma tabs read other sources. */
const STATEMENT_PREFIX: Record<string, string> = {
  is: "is",
  bs: "bs",
  gcf: "pcf",
  debt: "debt",
};

/**
 * Registry rows for the Tax Spread. The latest tax year wins a field's
 * display identity (line numbers can drift across years - the id is the
 * identity); family order and field order follow the registry data files.
 */
function registryRowMeta(): RegistryRowMeta[] {
  const latestByFamily = new Map<string, ReturnType<typeof listRegistryEntries>[number]>();
  for (const entry of listRegistryEntries()) {
    const cur = latestByFamily.get(entry.formFamily);
    if (!cur || entry.taxYear > cur.taxYear) latestByFamily.set(entry.formFamily, entry);
  }
  return [...latestByFamily.values()].flatMap((entry) =>
    entry.fields.map((f) => ({
      fieldId: f.fieldId,
      formFamily: entry.formFamily,
      lineNumber: f.lineNumber,
      label: f.label,
      taxonomyNodeKey: f.taxonomyNodeKey,
    })),
  );
}

export const spreadRouter = router({
  forDeal: protectedProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        entityId: z.string().uuid(),
        statement: z.enum(["is", "bs", "gcf", "debt"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const prefix = STATEMENT_PREFIX[input.statement]!;
      const [nodesRes, factsRes, metricsRes] = await Promise.all([
        ctx.supabase
          .from("taxonomy_nodes")
          .select("key, parent_key, label, sort_order, is_addback_relevant")
          .or(`key.eq.${prefix},key.like.${prefix}.%`)
          .order("sort_order", { ascending: true }),
        ctx.supabase
          .from("facts")
          .select(
            "id, taxonomy_node_key, value_cents, method, status, confidence, source_page, source_logical_document_id, periods(label)",
          )
          .eq("deal_id", input.dealId)
          .eq("entity_id", input.entityId)
          .like("taxonomy_node_key", `${prefix}%`),
        ctx.supabase
          .from("computed_metrics")
          .select(
            "metric, entity_id, period_label, value_kind, value_cents, ratio_mantissa, ratio_scale",
          )
          .eq("deal_id", input.dealId)
          .is("scenario_id", null),
      ]);
      for (const r of [nodesRes, factsRes, metricsRes]) {
        if (r.error)
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: r.error.message });
      }

      const nodes: TaxonomyNodeRow[] = (nodesRes.data ?? []).map((n) => ({
        key: n.key as string,
        parentKey: (n.parent_key as string | null) ?? null,
        label: n.label as string,
        sortOrder: n.sort_order as number,
        isAddbackRelevant: n.is_addback_relevant as boolean,
      }));
      const facts: SpreadFactRow[] = (factsRes.data ?? []).map((f) => ({
        id: f.id as string,
        taxonomyNodeKey: (f.taxonomy_node_key as string | null) ?? null,
        periodLabel: (f.periods as unknown as { label: string } | null)?.label ?? "(unknown)",
        valueCents: String(f.value_cents),
        method: f.method as string,
        status: f.status as string,
        confidence: (f.confidence as number | null) ?? null,
        sourcePage: (f.source_page as number | null) ?? null,
        sourceLogicalDocumentId: (f.source_logical_document_id as string | null) ?? null,
      }));

      const { periods, rows } = assembleSpread(nodes, facts);

      // Computed rows for this entity (per period) + deal-global rows.
      const computed = (metricsRes.data ?? [])
        .filter((m) => m.entity_id === input.entityId || m.entity_id === null)
        .map((m) => ({
          metric: m.metric as string,
          entityScope:
            (m.entity_id as string | null) === null ? ("deal" as const) : ("entity" as const),
          periodLabel: (m.period_label as string | null) ?? null,
          valueKind: m.value_kind as "cents" | "ratio",
          valueCents: m.value_cents === null ? null : String(m.value_cents),
          ratioMantissa: m.ratio_mantissa === null ? null : String(m.ratio_mantissa),
          ratioScale: (m.ratio_scale as number | null) ?? null,
        }));

      return { periods, rows, computed };
    }),

  /**
   * Tax Spread (M8.3 tax tab, ADR-0002 follow-up): registry-keyed rows per
   * form family - the only spread that can show registry-only facts
   * (derived lines like AGI that carry no taxonomy placement).
   */
  taxForDeal: protectedProcedure
    .input(z.object({ dealId: z.string().uuid(), entityId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const factsRes = await ctx.supabase
        .from("facts")
        .select(
          "id, registry_field_id, taxonomy_node_key, value_cents, method, status, confidence, source_page, source_logical_document_id, periods(label)",
        )
        .eq("deal_id", input.dealId)
        .eq("entity_id", input.entityId)
        .not("registry_field_id", "is", null);
      if (factsRes.error)
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: factsRes.error.message });

      const facts: TaxFactRow[] = (factsRes.data ?? []).map((f) => ({
        id: f.id as string,
        registryFieldId: f.registry_field_id as string,
        taxonomyNodeKey: (f.taxonomy_node_key as string | null) ?? null,
        periodLabel: (f.periods as unknown as { label: string } | null)?.label ?? "(unknown)",
        valueCents: String(f.value_cents),
        method: f.method as string,
        status: f.status as string,
        confidence: (f.confidence as number | null) ?? null,
        sourcePage: (f.source_page as number | null) ?? null,
        sourceLogicalDocumentId: (f.source_logical_document_id as string | null) ?? null,
      }));

      return assembleTaxSpread(registryRowMeta(), facts);
    }),

  /**
   * Inline label rename (M8.3): the reviewer saying "this source label
   * means THAT taxonomy node" - recorded as a learned mapping so the
   * statement mapper improves (Blueprint §4.3 feedback loop).
   */
  renameLabel: underwriterProcedure
    .input(
      z.object({
        nodeKey: z.string().min(1),
        label: z.string().min(1).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const labelNorm = normalizeLabel(input.label);
      const { data: existing, error: readErr } = await ctx.supabase
        .from("learned_mappings")
        .select("id, usage_count")
        .eq("tenant_id", ctx.profile.tenantId)
        .eq("label_norm", labelNorm)
        .maybeSingle();
      if (readErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: readErr.message });

      if (existing) {
        const { error } = await ctx.supabase
          .from("learned_mappings")
          .update({
            taxonomy_node_key: input.nodeKey,
            usage_count: (existing.usage_count as number) + 1,
            source: "human",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id as string);
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        return { learned: labelNorm, nodeKey: input.nodeKey, updated: true };
      }

      const { error } = await ctx.supabase.from("learned_mappings").insert({
        tenant_id: ctx.profile.tenantId,
        label_norm: labelNorm,
        taxonomy_node_key: input.nodeKey,
        usage_count: 1,
        confidence: 1,
        source: "human",
      });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { learned: labelNorm, nodeKey: input.nodeKey, updated: false };
    }),
});
