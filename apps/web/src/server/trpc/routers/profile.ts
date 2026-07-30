/**
 * Profile settings (M11.7). Self-scoped: `get` reads the caller's own row
 * (RLS), `update` goes through the update_own_profile() SECURITY DEFINER -
 * never a direct UPDATE, so full_name/email_notifications are the ONLY
 * columns a user can touch on their own row (role/status/tenant stay
 * admin-managed via profiles_update_manage).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../init";

export const profileRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("profiles")
      .select("id, email, full_name, role, email_notifications, tenants(name)")
      .eq("id", ctx.user.id)
      .single();
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    const org = data.tenants as { name: string } | { name: string }[] | null;
    return {
      id: data.id as string,
      email: data.email as string,
      fullName: (data.full_name as string | null) ?? null,
      role: data.role as string,
      emailNotifications: data.email_notifications as boolean,
      orgName: (Array.isArray(org) ? org[0]?.name : org?.name) ?? null,
    };
  }),

  // Self-scoped by construction (definer updates auth.uid() only) - listed
  // in SELF_SCOPED_EXCEPTIONS of the mutation-tier guard.
  update: protectedProcedure
    .input(
      z.object({
        fullName: z.string().trim().min(1).max(120).optional(),
        emailNotifications: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.fullName === undefined && input.emailNotifications === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "nothing to update" });
      }
      const { error } = await ctx.supabase.rpc("update_own_profile", {
        p_full_name: input.fullName ?? null,
        p_email_notifications: input.emailNotifications ?? null,
      });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),
});
