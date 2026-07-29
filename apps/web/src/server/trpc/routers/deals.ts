/**
 * Deals API (M8.2 shell / M8.7 dashboard). RLS-scoped reads; the workspace
 * rail and pipeline board render from these.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, underwriterProcedure } from "../init";

/** The board's vocabulary, in funnel order (deal_status enum, migration 0000). */
const DEAL_STATUSES = ["intake", "parsing", "review", "complete"] as const;

export const dealsRouter = router({
  get: protectedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("deals")
        .select("id, name, type, status, policy_pack_id, transcripts_enabled, created_at")
        .eq("id", input.dealId)
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "deal not found" });
      return {
        id: data.id as string,
        name: data.name as string,
        type: data.type as string,
        status: data.status as string,
        policyPackId: data.policy_pack_id as string,
        transcriptsEnabled: data.transcripts_enabled as boolean,
        createdAt: data.created_at as string,
      };
    }),

  /** Pipeline board (M8.7): deals + form families present + headline DSCR. */
  board: protectedProcedure.query(async ({ ctx }) => {
    const [dealsRes, ldRes, dscrRes, issuesRes] = await Promise.all([
      ctx.supabase
        .from("deals")
        .select("id, name, type, status, created_at, updated_at")
        .order("created_at", { ascending: false }),
      ctx.supabase.from("logical_documents").select("document_id, form_family, documents(deal_id)"),
      ctx.supabase
        .from("computed_metrics")
        .select("deal_id, metric, period_label, ratio_mantissa, ratio_scale")
        .eq("metric", "dscr_business")
        .is("scenario_id", null),
      // ui-10: open blocking issues are first-class on the board card.
      ctx.supabase.from("issues").select("deal_id").eq("status", "open"),
    ]);
    for (const r of [dealsRes, ldRes, dscrRes, issuesRes]) {
      if (r.error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: r.error.message });
    }
    const issuesByDeal = new Map<string, number>();
    for (const i of issuesRes.data ?? []) {
      const id = i.deal_id as string;
      issuesByDeal.set(id, (issuesByDeal.get(id) ?? 0) + 1);
    }

    const familiesByDeal = new Map<string, Set<string>>();
    for (const ld of ldRes.data ?? []) {
      const dealId = (ld.documents as unknown as { deal_id: string } | null)?.deal_id;
      if (!dealId) continue;
      const set = familiesByDeal.get(dealId) ?? new Set<string>();
      set.add(ld.form_family as string);
      familiesByDeal.set(dealId, set);
    }

    // Headline DSCR per deal: latest period's business DSCR (rendered as-is).
    const dscrByDeal = new Map<string, { mantissa: string; scale: number; period: string }>();
    for (const m of dscrRes.data ?? []) {
      if (m.ratio_mantissa === null || m.period_label === null) continue;
      const cur = dscrByDeal.get(m.deal_id as string);
      if (!cur || (m.period_label as string) > cur.period) {
        dscrByDeal.set(m.deal_id as string, {
          mantissa: String(m.ratio_mantissa),
          scale: (m.ratio_scale as number) ?? 2,
          period: m.period_label as string,
        });
      }
    }

    return (dealsRes.data ?? []).map((d) => ({
      id: d.id as string,
      name: d.name as string,
      type: d.type as string,
      status: d.status as string,
      createdAt: d.created_at as string,
      // The row says "Updated …"; it must be the real mtime, not created_at
      // wearing a different label.
      updatedAt: (d.updated_at as string | null) ?? (d.created_at as string),
      formFamilies: [...(familiesByDeal.get(d.id as string) ?? [])],
      dscr: dscrByDeal.get(d.id as string) ?? null,
      openIssues: issuesByDeal.get(d.id as string) ?? 0,
    }));
  }),

  /** New-deal wizard (M8.7): deal + entities in one step, pinned to the
   *  current policy pack. */
  create: underwriterProcedure
    .input(
      z.object({
        name: z.string().min(1).max(160),
        type: z.enum(["business_acquisition", "working_capital", "real_estate", "refinance"]),
        entities: z
          .array(
            z.object({
              name: z.string().min(1).max(160),
              kind: z.enum(["applicant", "target", "guarantor", "spouse", "epc", "oc"]),
            }),
          )
          .min(1)
          .max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Pin the newest policy pack (Iron Law #8: the deal keeps this version).
      const { data: pack, error: packErr } = await ctx.supabase
        .from("policy_packs")
        .select("id")
        .order("effective_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (packErr || !pack) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "no policy pack seeded" });
      }

      const { data: deal, error: dealErr } = await ctx.supabase
        .from("deals")
        .insert({
          tenant_id: ctx.profile.tenantId,
          name: input.name,
          type: input.type,
          policy_pack_id: pack.id as string,
        })
        .select("id")
        .single();
      if (dealErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: dealErr.message });

      const { error: entErr } = await ctx.supabase.from("entities").insert(
        input.entities.map((e) => ({
          tenant_id: ctx.profile.tenantId,
          deal_id: deal.id as string,
          name: e.name,
          kind: e.kind,
        })),
      );
      if (entErr) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: entErr.message });
      return { dealId: deal.id as string };
    }),

  /**
   * m8-10: the explicit human transition on the pipeline board — notably
   * review → complete, which no automation can decide.
   *
   * Deliberately NOT monotonic, unlike the pipeline writer
   * (packages/pipeline/src/trigger/ingest-document.ts): the worker only
   * ever moves a deal forward, so a human hand is the ONLY way back out of
   * a stage entered by mistake, or into review again after late documents
   * land. Take that away and a wrongly-completed deal is stuck forever.
   *
   * Runs as the caller: RLS (`deals_update`, 0001_rls-v1.sql:102) supplies
   * the tenant predicate and the admin/underwriter role check, so a missing
   * row here means "not yours or not visible", not "no such deal".
   */
  setStatus: underwriterProcedure
    .input(z.object({ dealId: z.string().uuid(), status: z.enum(DEAL_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("deals")
        .update({ status: input.status, updated_at: new Date().toISOString() })
        .eq("id", input.dealId)
        .select("id, status")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "deal not found" });
      return { dealId: data.id as string, status: data.status as string };
    }),
});
