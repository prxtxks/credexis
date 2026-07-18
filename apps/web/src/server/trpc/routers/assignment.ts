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
