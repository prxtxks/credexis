/**
 * Org bootstrap (M11.2, design 01 §4.1): the only app path that creates a
 * tenants/profiles pair. The DB function `create_organization` (0011) is
 * SECURITY DEFINER and enforces every invariant itself (authenticated,
 * profile-less caller, atomic insert, caller becomes org_owner) — this
 * router is a thin, session-gated shim over it. No INSERT policies exist
 * on tenants/profiles; function-only creation is the security posture.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, sessionProcedure } from "../init";

export const orgRouter = router({
  /** Signed-in, no profile yet → create the org and become org_owner. */
  create: sessionProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(120),
        kind: z.enum(["lender", "broker_firm", "solo_broker"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.profile) {
        throw new TRPCError({ code: "CONFLICT", message: "account already has a workspace" });
      }
      const { data, error } = await ctx.supabase.rpc("create_organization", {
        p_name: input.name,
        p_kind: input.kind,
      });
      if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      return { tenantId: data as string };
    }),

  /** Bootstrap status for routing: does this session have a workspace? */
  bootstrap: sessionProcedure.query(({ ctx }) => ({
    hasProfile: ctx.profile !== null,
    email: ctx.user.email ?? null,
    suggestedName: (ctx.user.user_metadata?.["full_name"] as string | undefined) ?? null,
  })),
});
