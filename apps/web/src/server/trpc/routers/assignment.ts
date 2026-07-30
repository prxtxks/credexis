/**
 * Document assignment API (M6.5): confirm/fix the Stage-S split suggestions.
 * Reads are RLS-scoped; mutations run as the caller (underwriter+) so the
 * 0005 audit trigger records actor + before/after on logical_documents.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, underwriterProcedure } from "../init";
import { buildAssignmentPatch } from "../../assignment/logic";

const dealId = z.object({ dealId: z.string().uuid() });

export const assignmentRouter = router({
  /** Every logical document of a deal, joined to its physical file. */
  list: protectedProcedure.input(dealId).query(async ({ ctx, input }) => {
    const { data, error } = await ctx.supabase
      .from("logical_documents")
      .select(
        "id, document_id, form_family, tax_year, page_start, page_end, entity_id, entity_confirmed, created_at, documents!inner(deal_id, file_name)",
      )
      .eq("documents.deal_id", input.dealId)
      .order("created_at", { ascending: true });
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    return (data ?? []).map((d) => ({
      id: d.id as string,
      documentId: d.document_id as string,
      fileName: (d.documents as unknown as { file_name: string }).file_name,
      formFamily: d.form_family as string,
      taxYear: (d.tax_year as number | null) ?? null,
      pageStart: d.page_start as number,
      pageEnd: d.page_end as number,
      entityId: (d.entity_id as string | null) ?? null,
      entityConfirmed: d.entity_confirmed as boolean,
    }));
  }),

  /** The deal's entities, for the assignment picker. */
  entities: protectedProcedure.input(dealId).query(async ({ ctx, input }) => {
    const { data, error } = await ctx.supabase
      .from("entities")
      .select("id, name, kind")
      .eq("deal_id", input.dealId)
      .order("name", { ascending: true });
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return (data ?? []).map((e) => ({
      id: e.id as string,
      name: e.name as string,
      kind: e.kind as string,
    }));
  }),

  /** Confirm/fix one logical document (audited by the DB trigger). */
  assign: underwriterProcedure
    .input(
      z.object({
        logicalDocumentId: z.string().uuid(),
        formFamily: z.string().optional(),
        taxYear: z.number().int().nullable().optional(),
        entityId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let patch: Record<string, unknown>;
      try {
        patch = buildAssignmentPatch({
          ...(input.formFamily !== undefined ? { formFamily: input.formFamily } : {}),
          ...(input.taxYear !== undefined ? { taxYear: input.taxYear } : {}),
          ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
        });
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }

      const { data, error } = await ctx.supabase
        .from("logical_documents")
        .update(patch)
        .eq("id", input.logicalDocumentId)
        .select("id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "logical document not found" });
      return { logicalDocumentId: data.id as string };
    }),
});

/**
 * M11.6: identity matches for the assignment screen - the printed name,
 * its deterministic score, and the suggested entity, keyed by logical
 * document. Deciding (confirm/reject) is underwriter-tier; RLS enforces
 * the same floor.
 */
export const identitiesRouter = router({
  forDeal: protectedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Identities reach the deal through logical_documents → documents.
      const { data, error } = await ctx.supabase
        .from("document_identities")
        .select(
          "id, logical_document_id, entity_id, extracted_name, source_page, method, score_bps, band, state, logical_documents(document_id, documents(deal_id))",
        )
        .eq("tenant_id", ctx.profile.tenantId);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return (data ?? [])
        .filter((r) => {
          const ld = r.logical_documents as unknown as {
            documents: { deal_id: string } | null;
          } | null;
          return ld?.documents?.deal_id === input.dealId;
        })
        .map((r) => ({
          id: r.id as string,
          logicalDocumentId: r.logical_document_id as string,
          entityId: (r.entity_id as string | null) ?? null,
          extractedName: r.extracted_name as string,
          sourcePage: (r.source_page as number | null) ?? null,
          method: r.method as string,
          scoreBps: r.score_bps as number,
          band: r.band as string,
          state: r.state as string,
        }));
    }),

  decide: underwriterProcedure
    .input(
      z.object({
        identityId: z.string().uuid(),
        state: z.enum(["confirmed", "rejected"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("document_identities")
        .update({ state: input.state })
        .eq("id", input.identityId)
        .select("id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "identity match not found" });
      return { id: data.id as string, state: input.state };
    }),
});
