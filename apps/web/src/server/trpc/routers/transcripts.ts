/**
 * IRS transcripts API (M9.2/M9.3/M9.5): per-deal feature flag, consent
 * tracking, and transcript ingest. Fully functional with no provider -
 * requestConsent explains itself instead of failing the deal.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { listRegistryEntries, resolveProvider } from "@credexis/extraction";
import { protectedProcedure, router, underwriterProcedure } from "../init";
import { transcriptFactRows } from "../../transcripts/logic";
import { recomputeDeal } from "../../metrics/recompute";

/** Field id → taxonomy placement from the CODE registry - the versioned
 *  single source of truth. (The form_registry DB projection sat EMPTY in
 *  production; binding from code cannot drift. Iron Law #4: identity,
 *  never ordinals - and never a second copy of the truth.) */
function registryBinding(): {
  known: Set<string>;
  taxonomyByRegistryField: Record<string, string | undefined>;
} {
  const known = new Set<string>();
  const taxonomyByRegistryField: Record<string, string | undefined> = {};
  for (const entry of listRegistryEntries()) {
    for (const f of entry.fields) {
      known.add(f.fieldId);
      if (f.taxonomyNodeKey !== null) taxonomyByRegistryField[f.fieldId] = f.taxonomyNodeKey;
    }
  }
  return { known, taxonomyByRegistryField };
}

const dealId = z.object({ dealId: z.string().uuid() });

export const transcriptsRouter = router({
  forDeal: protectedProcedure.input(dealId).query(async ({ ctx, input }) => {
    const [dealRes, consentsRes] = await Promise.all([
      ctx.supabase
        .from("deals")
        .select("id, transcripts_enabled")
        .eq("id", input.dealId)
        .maybeSingle(),
      ctx.supabase
        .from("transcript_consents")
        .select("id, entity_id, provider, status, updated_at")
        .eq("deal_id", input.dealId),
    ]);
    if (dealRes.error || !dealRes.data) {
      throw new TRPCError({ code: "NOT_FOUND", message: "deal not found" });
    }
    if (consentsRes.error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: consentsRes.error.message });
    }
    return {
      enabled: dealRes.data.transcripts_enabled as boolean,
      providerConfigured:
        resolveProvider({
          TRANSCRIPT_PROVIDER: process.env["TRANSCRIPT_PROVIDER"],
          TRANSCRIPT_PROVIDER_API_KEY: process.env["TRANSCRIPT_PROVIDER_API_KEY"],
        }) !== null,
      consents: (consentsRes.data ?? []).map((c) => ({
        id: c.id as string,
        entityId: c.entity_id as string,
        provider: c.provider as string,
        status: c.status as string,
        updatedAt: c.updated_at as string,
      })),
    };
  }),

  /** M9.5: transcripts are additive, per-deal. */
  setEnabled: underwriterProcedure
    .input(z.object({ dealId: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("deals")
        .update({ transcripts_enabled: input.enabled })
        .eq("id", input.dealId)
        .select("id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "deal not found" });
      return { enabled: input.enabled };
    }),

  /** 8821 consent request - provider-backed once M9.1 selects one. */
  requestConsent: underwriterProcedure
    .input(z.object({ dealId: z.string().uuid(), entityId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const provider = resolveProvider({
        TRANSCRIPT_PROVIDER: process.env["TRANSCRIPT_PROVIDER"],
        TRANSCRIPT_PROVIDER_API_KEY: process.env["TRANSCRIPT_PROVIDER_API_KEY"],
      });
      if (!provider) {
        return {
          requested: false as const,
          reason:
            "No transcript provider configured yet - provider selection is M9.1 ([PRATIK], ADR-0003).",
        };
      }
      // Adapter path (unreachable until a provider registers): create the
      // consent row, hand off to the provider, store the external ref.
      const { data: entity } = await ctx.supabase
        .from("entities")
        .select("id, name")
        .eq("id", input.entityId)
        .maybeSingle();
      if (!entity) throw new TRPCError({ code: "NOT_FOUND", message: "entity not found" });
      const consent = await provider.requestConsent({
        entityName: entity.name as string,
        entityExternalRef: entity.id as string,
      });
      const { error } = await ctx.supabase.from("transcript_consents").insert({
        tenant_id: ctx.profile.tenantId,
        deal_id: input.dealId,
        entity_id: input.entityId,
        provider: provider.name,
        status: consent.status,
        external_ref: consent.externalRef,
      });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { requested: true as const, status: consent.status };
    }),

  /**
   * Provider fetch (M19): the bridge the seam was waiting for. For an
   * entity with a signed consent, pull transcripts for every fiscal year
   * the entity actually has periods for, bind lines by registry field id,
   * insert as method=transcript facts, mark the consent retrieved, and
   * recompute once - G5 does the parsed-vs-transcript judgment.
   */
  fetchFromProvider: underwriterProcedure
    .input(z.object({ dealId: z.string().uuid(), entityId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const provider = resolveProvider({
        TRANSCRIPT_PROVIDER: process.env["TRANSCRIPT_PROVIDER"],
        TRANSCRIPT_PROVIDER_API_KEY: process.env["TRANSCRIPT_PROVIDER_API_KEY"],
      });
      if (!provider) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "no provider configured" });
      }
      const { data: consent } = await ctx.supabase
        .from("transcript_consents")
        .select("id, external_ref, status")
        .eq("deal_id", input.dealId)
        .eq("entity_id", input.entityId)
        .in("status", ["signed", "retrieved"])
        .maybeSingle();
      if (!consent) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "no signed consent" });
      }

      // Fiscal years = the entity's existing FY periods; transcript years
      // outside them have nothing to compare against and are skipped.
      const { data: periods, error: perErr } = await ctx.supabase
        .from("periods")
        .select("id, label")
        .eq("entity_id", input.entityId)
        .like("label", "FY%");
      if (perErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: perErr.message });
      const periodByYear = new Map<number, string>();
      for (const p of periods ?? []) {
        const year = Number(/^FY(\d{4})$/.exec(p.label as string)?.[1]);
        if (Number.isFinite(year)) periodByYear.set(year, p.id as string);
      }
      if (periodByYear.size === 0) {
        return { inserted: 0, payloads: 0, skippedYears: [] as number[] };
      }

      const payloads = await provider.fetchTranscripts(consent.external_ref as string, [
        ...periodByYear.keys(),
      ]);

      const { known: knownFields, taxonomyByRegistryField } = registryBinding();

      let inserted = 0;
      const skippedYears: number[] = [];
      for (const payload of payloads) {
        const periodId = periodByYear.get(payload.taxYear);
        if (!periodId) {
          skippedYears.push(payload.taxYear);
          continue;
        }
        // Unknown registry ids are dropped, not guessed (Iron Law #1) -
        // a provider line we cannot bind by identity is not a fact.
        const lines = payload.lines.filter((l) => knownFields.has(l.registryFieldId));
        if (lines.length === 0) continue;
        const rows = transcriptFactRows(lines, {
          tenantId: ctx.profile.tenantId,
          dealId: input.dealId,
          entityId: input.entityId,
          periodId,
          taxonomyByRegistryField,
        });
        const { error: insErr } = await ctx.supabase.from("facts").insert(rows);
        if (insErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: insErr.message });
        inserted += rows.length;
      }

      await ctx.supabase
        .from("transcript_consents")
        .update({ status: "retrieved" })
        .eq("id", consent.id as string);
      const recompute = await recomputeDeal(ctx.supabase, ctx.profile.tenantId, input.dealId);
      return {
        inserted,
        payloads: payloads.length,
        skippedYears: [...new Set(skippedYears)],
        openIssues: recompute.openIssues ?? 0,
      };
    }),

  /**
   * Transcript ingest (M9.3): structured payload → transcript facts →
   * recompute (G5 compares parsed vs transcript per registry field id).
   * Called by the provider adapter; callable directly for verification.
   */
  ingest: underwriterProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        entityId: z.string().uuid(),
        periodId: z.string().uuid(),
        lines: z
          .array(
            z.object({
              registryFieldId: z.string().min(1),
              valueCents: z.string().regex(/^-?\d+$/),
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { taxonomyByRegistryField } = registryBinding();

      let rows;
      try {
        rows = transcriptFactRows(input.lines, {
          tenantId: ctx.profile.tenantId,
          dealId: input.dealId,
          entityId: input.entityId,
          periodId: input.periodId,
          taxonomyByRegistryField,
        });
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }

      const { error: insErr } = await ctx.supabase.from("facts").insert(rows);
      if (insErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: insErr.message });

      const recompute = await recomputeDeal(ctx.supabase, ctx.profile.tenantId, input.dealId);
      return { inserted: rows.length, openIssues: recompute.openIssues ?? 0 };
    }),
});
