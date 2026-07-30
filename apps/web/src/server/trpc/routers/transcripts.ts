/**
 * IRS transcripts API (M9.2/M9.3/M9.5): per-deal feature flag, consent
 * tracking, and transcript ingest. Fully functional with no provider -
 * requestConsent explains itself instead of failing the deal.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { resolveProvider } from "@credexis/extraction";
import { protectedProcedure, router, underwriterProcedure } from "../init";
import { transcriptFactRows } from "../../transcripts/logic";
import { recomputeDeal } from "../../metrics/recompute";

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
      // Registry field → taxonomy node placement (bind by identity, never
      // ordinal - Iron Law #4).
      const { data: registry, error: regErr } = await ctx.supabase
        .from("form_registry")
        .select("field_id, taxonomy_node_key")
        .in(
          "field_id",
          input.lines.map((l) => l.registryFieldId),
        );
      if (regErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: regErr.message });

      const taxonomyByRegistryField: Record<string, string | undefined> = {};
      for (const r of registry ?? []) {
        taxonomyByRegistryField[r.field_id as string] =
          (r.taxonomy_node_key as string | null) ?? undefined;
      }

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
