/**
 * Org bootstrap (M11.2, design 01 §4.1): the only app path that creates a
 * tenants/profiles pair. The DB function `create_organization` (0011) is
 * SECURITY DEFINER and enforces every invariant itself (authenticated,
 * profile-less caller, atomic insert, caller becomes org_owner) — this
 * router is a thin, session-gated shim over it. No INSERT policies exist
 * on tenants/profiles; function-only creation is the security posture.
 */

import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router, sessionProcedure } from "../init";

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

/**
 * Members & invites (M11.3). The DB enforces the tier lattice (0013 —
 * A1 fix); these procedures are the UX layer. Invite delivery is
 * copy-the-link pre-pilot (no email infra; verdict CUT list): create
 * returns the raw token ONCE, only its sha256 is stored.
 */
export const membersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("profiles")
      .select("id, email, full_name, role, status, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return (data ?? []).map((p) => ({
      id: p.id as string,
      email: p.email as string,
      fullName: (p.full_name as string | null) ?? null,
      role: p.role as string,
      status: p.status as string,
      createdAt: p.created_at as string,
    }));
  }),

  setRole: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        role: z.enum(["admin", "underwriter", "viewer"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // RLS profiles_update_manage enforces the lattice; a denied update
      // matches zero rows rather than erroring — surface that honestly.
      const { data, error } = await ctx.supabase
        .from("profiles")
        .update({ role: input.role, updated_at: new Date().toISOString() })
        .eq("id", input.userId)
        .select("id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "not permitted for this member (tier lattice)",
        });
      return { userId: data.id as string };
    }),

  setStatus: adminProcedure
    .input(z.object({ userId: z.string().uuid(), status: z.enum(["active", "deactivated"]) }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.profile.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "cannot deactivate yourself" });
      }
      const { data, error } = await ctx.supabase
        .from("profiles")
        .update({ status: input.status, updated_at: new Date().toISOString() })
        .eq("id", input.userId)
        .select("id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "not permitted for this member (tier lattice)",
        });
      return { userId: data.id as string, status: input.status };
    }),
});

export const invitesRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("invites")
      .select("id, email, role, expires_at, accepted_at, revoked_at, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return (data ?? []).map((i) => ({
      id: i.id as string,
      email: i.email as string,
      role: i.role as string,
      expiresAt: i.expires_at as string,
      acceptedAt: (i.accepted_at as string | null) ?? null,
      revokedAt: (i.revoked_at as string | null) ?? null,
      createdAt: i.created_at as string,
    }));
  }),

  create: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(["admin", "underwriter", "viewer"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await ctx.supabase
        .from("invites")
        .insert({
          tenant_id: ctx.profile.tenantId,
          email: input.email.toLowerCase(),
          role: input.role,
          token_hash: tokenHash,
          invited_by: ctx.profile.id,
          expires_at: expiresAt,
        })
        .select("id")
        .maybeSingle();
      if (error) {
        // RLS WITH CHECK failure = lattice denial (e.g. admin minting admin)
        throw new TRPCError({ code: "FORBIDDEN", message: error.message });
      }
      // The raw token is returned exactly once for the copyable link.
      return { inviteId: data?.id as string, token, expiresAt };
    }),

  revoke: adminProcedure
    .input(z.object({ inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("invites")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", input.inviteId)
        .is("accepted_at", null)
        .select("id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      if (!data)
        throw new TRPCError({ code: "NOT_FOUND", message: "invite not found or accepted" });
      return { inviteId: data.id as string };
    }),

  /** Signed-in, profile-less claim (design 01 §4.3) — definer enforces all. */
  accept: sessionProcedure
    .input(z.object({ token: z.string().min(32) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.profile) {
        throw new TRPCError({ code: "CONFLICT", message: "account already has a workspace" });
      }
      const { data, error } = await ctx.supabase.rpc("accept_invite", { p_token: input.token });
      if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      return { tenantId: data as string };
    }),
});
