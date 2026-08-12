/**
 * Org export branding (M17): the bank's identity on every workbook. One
 * row per tenant (migration 0037, RLS + audit); admins write, everyone
 * reads - the export route embeds it in generated files.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../init";

const HEX = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_BRANDING = {
  displayName: "",
  primaryColor: "#0D7A5F",
  accentColor: "#134E3A",
  footerText: "",
} as const;

export const brandingRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("org_branding")
      .select("display_name, logo_path, primary_color, accent_color, footer_text, updated_at")
      .eq("tenant_id", ctx.profile.tenantId)
      .maybeSingle();
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    if (!data) return { ...DEFAULT_BRANDING, logoPath: null, saved: false };
    return {
      displayName: (data.display_name as string) ?? "",
      primaryColor: (data.primary_color as string) ?? DEFAULT_BRANDING.primaryColor,
      accentColor: (data.accent_color as string) ?? DEFAULT_BRANDING.accentColor,
      footerText: (data.footer_text as string) ?? "",
      logoPath: (data.logo_path as string | null) ?? null,
      saved: true,
    };
  }),

  save: adminProcedure
    .input(
      z.object({
        displayName: z.string().max(120),
        primaryColor: z.string().regex(HEX, "colors are #RRGGBB"),
        accentColor: z.string().regex(HEX, "colors are #RRGGBB"),
        footerText: z.string().max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.from("org_branding").upsert(
        {
          tenant_id: ctx.profile.tenantId,
          display_name: input.displayName,
          primary_color: input.primaryColor,
          accent_color: input.accentColor,
          footer_text: input.footerText,
          updated_by: ctx.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" },
      );
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { saved: true };
    }),
});
