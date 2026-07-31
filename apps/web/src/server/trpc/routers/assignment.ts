/**
 * Document assignment API (M6.5): confirm/fix the Stage-S split suggestions.
 * Reads are RLS-scoped; mutations run as the caller (underwriter+) so the
 * 0005 audit trigger records actor + before/after on logical_documents.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, underwriterProcedure } from "../init";
import {
  buildAssignmentPatch,
  planSpanMerge,
  splitSpanAt,
  validateSpanEdit,
} from "../../assignment/logic";

/** One span row + its siblings on the same physical document (RLS-scoped). */
async function spanWithSiblings(
  supabase: {
    from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  },
  logicalDocumentId: string,
) {
  const { data: target, error } = await supabase
    .from("logical_documents")
    .select("id, tenant_id, document_id, form_family, tax_year, entity_id, page_start, page_end")
    .eq("id", logicalDocumentId)
    .maybeSingle();
  if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "logical document not found" });
  const { data: siblings, error: sibErr } = await supabase
    .from("logical_documents")
    .select("id, page_start, page_end")
    .eq("document_id", target.document_id);
  if (sibErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: sibErr.message });
  return { target, siblings: siblings ?? [] };
}

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
      // Page order, not insert order (M13.5): a span created by a split
      // must appear where its pages are, not appended at the bottom.
      .order("document_id", { ascending: true })
      .order("page_start", { ascending: true });
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

  /** Correct a span's page range (M13.5). Overlaps with sibling spans are
   *  rejected server-side; the 0005 audit trigger records before/after. */
  setPages: underwriterProcedure
    .input(
      z.object({
        logicalDocumentId: z.string().uuid(),
        pageStart: z.number().int(),
        pageEnd: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { target, siblings } = await spanWithSiblings(ctx.supabase, input.logicalDocumentId);
      let patch: { page_start: number; page_end: number };
      try {
        patch = validateSpanEdit(
          { id: target.id, pageStart: target.page_start, pageEnd: target.page_end },
          siblings.map((s: { id: string; page_start: number; page_end: number }) => ({
            id: s.id,
            pageStart: s.page_start,
            pageEnd: s.page_end,
          })),
          input.pageStart,
          input.pageEnd,
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
      // ONE definer call (migration 0034): the range moves and every fact's
      // page citation re-bases by the same delta in one transaction, so a
      // click here can never send the inspector to the wrong PDF page.
      const { error } = await ctx.supabase.rpc("set_logical_document_pages", {
        p_span: input.logicalDocumentId,
        p_start: patch.page_start,
        p_end: patch.page_end,
      });
      if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      return { logicalDocumentId: input.logicalDocumentId };
    }),

  /** Split one span at a page (M13.5). The write is ONE definer call
   *  (migration 0034) so insert-then-shrink is atomic: a half-applied
   *  split would leave overlapping ranges and the screen would lie about
   *  which pages belong to which form. The pure helper still runs first
   *  so the reviewer gets the friendly message without a round trip. */
  split: underwriterProcedure
    .input(
      z.object({
        logicalDocumentId: z.string().uuid(),
        atPage: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { target } = await spanWithSiblings(ctx.supabase, input.logicalDocumentId);
      try {
        splitSpanAt({ pageStart: target.page_start, pageEnd: target.page_end }, input.atPage);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
      const { data, error } = await ctx.supabase.rpc("split_logical_document", {
        p_span: input.logicalDocumentId,
        p_at_page: input.atPage,
      });
      if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      return { logicalDocumentId: input.logicalDocumentId, newLogicalDocumentId: data as string };
    }),

  /** Merge a span into its adjacent neighbour (M13.5) - the inverse of
   *  split, so a reviewer who divides a form by mistake is not stranded.
   *  ONE definer call (migration 0034): re-point the absorbed span's
   *  facts/pages/identities, extend the survivor, delete the absorbed row,
   *  all in one transaction. The definer also owns the delete, which RLS
   *  reserves for admins - the first cut called .delete() directly, RLS
   *  matched zero rows, and supabase-js reported no error, leaving a
   *  duplicate overlapping span behind. */
  merge: underwriterProcedure
    .input(
      z.object({
        logicalDocumentId: z.string().uuid(),
        intoLogicalDocumentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { target, siblings } = await spanWithSiblings(ctx.supabase, input.logicalDocumentId);
      const other = siblings.find((s: { id: string }) => s.id === input.intoLogicalDocumentId) as
        | { id: string; page_start: number; page_end: number }
        | undefined;
      if (!other) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "spans must belong to the same uploaded file to merge",
        });
      }
      try {
        planSpanMerge(
          { id: target.id, pageStart: target.page_start, pageEnd: target.page_end },
          { id: other.id, pageStart: other.page_start, pageEnd: other.page_end },
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
      const { data, error } = await ctx.supabase.rpc("merge_logical_documents", {
        p_span: input.logicalDocumentId,
        p_into: input.intoLogicalDocumentId,
      });
      if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      return { survivorId: data as string };
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
