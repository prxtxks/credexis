/**
 * Source viewer API (M8.4 — the hero feature): a selected cell's full
 * lineage (document, page, bbox, method, confidence, supersession chain)
 * plus a short-TTL signed URL for the PDF render. Overrides supersede
 * accepted facts (never mutate — Iron Law #5); revert restores the
 * original and rejects the override. Every mutation recomputes.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, underwriterProcedure } from "../init";
import { buildSupersession, type SupersedableFact } from "../../review/logic";
import { recomputeDeal } from "../../metrics/recompute";
import { DEAL_DOCUMENTS_BUCKET } from "@/lib/storage";

const SIGNED_URL_TTL_SECONDS = 120; // short-lived: viewer fetches on demand

export const sourceRouter = router({
  factDetail: protectedProcedure
    .input(z.object({ factId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: f, error } = await ctx.supabase
        .from("facts")
        .select(
          `id, deal_id, value_cents, original_value_cents, method, status, confidence,
           taxonomy_node_key, registry_field_id, source_page, source_bbox, superseded_by,
           created_at, source_logical_document_id,
           logical_documents(id, page_start, page_end, form_family, tax_year,
             documents(id, file_name, mime_type, storage_path))`,
        )
        .eq("id", input.factId)
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!f) throw new TRPCError({ code: "NOT_FOUND", message: "fact not found" });

      const ld = f.logical_documents as unknown as {
        id: string;
        page_start: number;
        page_end: number;
        form_family: string;
        tax_year: number | null;
        documents: {
          id: string;
          file_name: string;
          mime_type: string;
          storage_path: string;
        } | null;
      } | null;

      // Signed URL for the physical PDF (RLS-scoped storage read).
      let signedUrl: string | null = null;
      if (ld?.documents?.storage_path && ld.documents.mime_type === "application/pdf") {
        const { data: signed } = await ctx.supabase.storage
          .from(DEAL_DOCUMENTS_BUCKET)
          .createSignedUrl(ld.documents.storage_path, SIGNED_URL_TTL_SECONDS);
        signedUrl = signed?.signedUrl ?? null;
      }

      const sourcePage = (f.source_page as number | null) ?? null;
      return {
        factId: f.id as string,
        dealId: f.deal_id as string,
        valueCents: String(f.value_cents),
        originalValueCents: f.original_value_cents === null ? null : String(f.original_value_cents),
        method: f.method as string,
        status: f.status as string,
        confidence: (f.confidence as number | null) ?? null,
        taxonomyNodeKey: (f.taxonomy_node_key as string | null) ?? null,
        registryFieldId: (f.registry_field_id as string | null) ?? null,
        bbox: (f.source_bbox as { x: number; y: number; w: number; h: number } | null) ?? null,
        supersededBy: (f.superseded_by as string | null) ?? null,
        createdAt: f.created_at as string,
        document: ld?.documents
          ? {
              fileName: ld.documents.file_name,
              formFamily: ld.form_family,
              taxYear: ld.tax_year,
              /** 1-based page in the PHYSICAL pdf (logical start + offset). */
              pdfPage: sourcePage !== null ? ld.page_start + sourcePage - 1 : ld.page_start,
              signedUrl,
            }
          : null,
      };
    }),

  /** Override an accepted (or suggested) cell — supersession, never mutation. */
  override: underwriterProcedure
    .input(
      z.object({
        factId: z.string().uuid(),
        correctedCents: z.string().regex(/^-?\d+$/),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: oldFact, error: readErr } = await ctx.supabase
        .from("facts")
        .select(
          "id, tenant_id, deal_id, entity_id, period_id, taxonomy_node_key, registry_field_id, value_cents, status, source_logical_document_id, source_page, source_bbox",
        )
        .eq("id", input.factId)
        .maybeSingle();
      if (readErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: readErr.message });
      if (!oldFact) throw new TRPCError({ code: "NOT_FOUND", message: "fact not found" });

      let plan;
      try {
        plan = buildSupersession(
          oldFact as unknown as SupersedableFact,
          input.correctedCents,
          ctx.profile.id,
          input.note,
          { allowAccepted: true },
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }

      const { data: inserted, error: insErr } = await ctx.supabase
        .from("facts")
        .insert(plan.insert)
        .select("id")
        .single();
      if (insErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: insErr.message });

      const { data: patched, error: patchErr } = await ctx.supabase
        .from("facts")
        .update({ ...plan.patch, superseded_by: inserted.id as string })
        .eq("id", input.factId)
        .in("status", ["suggested", "accepted"]) // lost race → compensate
        .select("id")
        .maybeSingle();
      if (patchErr || !patched) {
        await ctx.supabase
          .from("facts")
          .delete()
          .eq("id", inserted.id as string);
        throw new TRPCError({
          code: "CONFLICT",
          message: patchErr?.message ?? "fact changed under you — override discarded",
        });
      }

      await recomputeDeal(ctx.supabase, ctx.profile.tenantId, oldFact.deal_id as string);
      return { overrideFactId: inserted.id as string };
    }),

  /** Revert an override: original back to accepted, override rejected. */
  revert: underwriterProcedure
    .input(z.object({ overrideFactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: override, error: readErr } = await ctx.supabase
        .from("facts")
        .select("id, deal_id, method, status")
        .eq("id", input.overrideFactId)
        .maybeSingle();
      if (readErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: readErr.message });
      if (!override || override.method !== "override") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "not an override fact" });
      }

      const { data: original, error: origErr } = await ctx.supabase
        .from("facts")
        .update({ status: "accepted", superseded_by: null })
        .eq("superseded_by", input.overrideFactId)
        .select("id")
        .maybeSingle();
      if (origErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: origErr.message });
      if (!original) {
        throw new TRPCError({ code: "NOT_FOUND", message: "no superseded original found" });
      }

      const { error: rejErr } = await ctx.supabase
        .from("facts")
        .update({ status: "rejected" })
        .eq("id", input.overrideFactId);
      if (rejErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: rejErr.message });

      await recomputeDeal(ctx.supabase, ctx.profile.tenantId, override.deal_id as string);
      return { restoredFactId: original.id as string };
    }),
});
