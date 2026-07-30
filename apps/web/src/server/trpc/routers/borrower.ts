/**
 * Borrower invitations, broker side (M12.1 PR4).
 *
 * Everything here is ORG-side: minting invites, requesting documents, and
 * curating what the borrower sees. The borrower's own surface lives in the
 * portal app and reaches the database only through definers.
 *
 * Two shapes are load-bearing:
 * - The raw invite token is returned EXACTLY ONCE, from `create`. Only its
 *   sha256 is stored (the 0013 pattern), so a lost link is re-minted, never
 *   recovered.
 * - `requestedItems` is SNAPSHOTTED at mint time from the deal's checklist.
 *   The borrower's list must not silently change because someone edited a
 *   deal type later.
 */

import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { borrowerInviteEmail } from "@credexis/shared";
import { checklistFor } from "@/lib/doc-checklist";
import { appBaseUrl, emailSender } from "../../email";
import { protectedProcedure, router, underwriterProcedure } from "../init";

const requestedItemSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  formFamilies: z.array(z.string().min(1).max(40)).max(12),
});

/** Portal link for a raw token - the portal origin, never the app origin. */
function claimUrl(token: string): string {
  const base = process.env["NEXT_PUBLIC_PORTAL_URL"] ?? `${appBaseUrl()}/portal`;
  return `${base.replace(/\/$/, "")}/claim?token=${token}`;
}

export const borrowersRouter = router({
  /** Everyone the org knows, for the invite picker. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("borrowers")
      .select("id, full_name, email, phone, created_at")
      .order("full_name");
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return (data ?? []).map((b) => ({
      id: b.id as string,
      fullName: b.full_name as string,
      email: b.email as string,
      phone: (b.phone as string | null) ?? null,
      createdAt: b.created_at as string,
    }));
  }),

  create: underwriterProcedure
    .input(
      z.object({
        fullName: z.string().trim().min(1).max(160),
        email: z.string().trim().email().max(254),
        phone: z.string().trim().max(40).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("borrowers")
        .insert({
          tenant_id: ctx.profile.tenantId,
          full_name: input.fullName,
          email: input.email.toLowerCase(),
          phone: input.phone ?? null,
          created_by: ctx.profile.id,
        })
        .select("id")
        .maybeSingle();
      if (error) {
        // Unique (tenant, lower(email)) - the borrower already exists HERE.
        // The message never implies anything about other tenants.
        if (error.code === "23505") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "You already have a borrower with this email address.",
          });
        }
        throw new TRPCError({ code: "FORBIDDEN", message: error.message });
      }
      return { borrowerId: data?.id as string };
    }),
});

export const borrowerInvitesRouter = router({
  forDeal: protectedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("borrower_invites")
        .select(
          "id, borrower_id, email, status, portal_status, display_label, entity_label, entity_id, requested_items, expires_at, claimed_at, last_reminded_at, revoked_at, created_at, borrowers(full_name)",
        )
        .eq("deal_id", input.dealId)
        .order("created_at", { ascending: false });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return (data ?? []).map((i) => {
        const b = i.borrowers as { full_name: string } | { full_name: string }[] | null;
        return {
          id: i.id as string,
          borrowerId: i.borrower_id as string,
          borrowerName: (Array.isArray(b) ? b[0]?.full_name : b?.full_name) ?? null,
          email: i.email as string,
          status: i.status as string,
          portalStatus: i.portal_status as string,
          displayLabel: i.display_label as string,
          entityLabel: (i.entity_label as string | null) ?? null,
          entityId: (i.entity_id as string | null) ?? null,
          requestedItems: (i.requested_items as { key: string; label: string }[]) ?? [],
          expiresAt: i.expires_at as string,
          claimedAt: (i.claimed_at as string | null) ?? null,
          lastRemindedAt: (i.last_reminded_at as string | null) ?? null,
          revokedAt: (i.revoked_at as string | null) ?? null,
          createdAt: i.created_at as string,
        };
      });
    }),

  create: underwriterProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        borrowerId: z.string().uuid(),
        entityId: z.string().uuid().optional(),
        /** Defaults to the deal name; snapshotted so later renames stay private. */
        displayLabel: z.string().trim().min(1).max(160).optional(),
        entityLabel: z.string().trim().max(160).optional(),
        /** Defaults to checklistFor(deal.type); broker-editable at mint time. */
        requestedItems: z.array(requestedItemSchema).max(20).optional(),
        expiresInDays: z.number().int().min(1).max(60).default(30),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [{ data: deal }, { data: borrower }] = await Promise.all([
        ctx.supabase.from("deals").select("name, type").eq("id", input.dealId).maybeSingle(),
        ctx.supabase
          .from("borrowers")
          .select("full_name, email")
          .eq("id", input.borrowerId)
          .maybeSingle(),
      ]);
      if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "deal not found" });
      if (!borrower) throw new TRPCError({ code: "NOT_FOUND", message: "borrower not found" });

      const items =
        input.requestedItems ??
        checklistFor(deal.type as string).map((c) => ({
          key: c.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .slice(0, 60),
          label: c.label,
          formFamilies: c.formFamilies,
        }));

      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 3600 * 1000).toISOString();

      const { data, error } = await ctx.supabase
        .from("borrower_invites")
        .insert({
          tenant_id: ctx.profile.tenantId,
          deal_id: input.dealId,
          borrower_id: input.borrowerId,
          entity_id: input.entityId ?? null,
          email: (borrower.email as string).toLowerCase(),
          token_hash: tokenHash,
          display_label: input.displayLabel ?? (deal.name as string),
          entity_label: input.entityLabel ?? null,
          requested_items: items,
          invited_by: ctx.profile.id,
          expires_at: expiresAt,
        })
        .select("id")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This borrower already has a live invitation on this deal.",
          });
        }
        throw new TRPCError({ code: "FORBIDDEN", message: error.message });
      }

      let emailSent = false;
      try {
        const sender = emailSender();
        if (sender.enabled) {
          const rendered = borrowerInviteEmail({
            borrowerName: borrower.full_name as string,
            dealLabel: input.displayLabel ?? (deal.name as string),
            claimUrl: claimUrl(token),
            expiresAtLabel: `in ${input.expiresInDays} days`,
          });
          emailSent = (await sender.send({ to: borrower.email as string, ...rendered })).sent;
        }
      } catch {
        emailSent = false;
      }

      // The raw token leaves the server exactly once.
      return { inviteId: data?.id as string, token, claimUrl: claimUrl(token), emailSent };
    }),

  /** Extend a live invite. Expiry is not terminal - this is routine chasing. */
  extend: underwriterProcedure
    .input(
      z.object({
        inviteId: z.string().uuid(),
        days: z.number().int().min(1).max(60).default(30),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const expiresAt = new Date(Date.now() + input.days * 24 * 3600 * 1000).toISOString();
      const { data, error } = await ctx.supabase
        .from("borrower_invites")
        .update({ expires_at: expiresAt })
        .eq("id", input.inviteId)
        .select("id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "FORBIDDEN", message: error.message });
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "invitation not found" });
      return { expiresAt };
    }),

  /** Revocation is ONE-WAY (0026 guard): a killed invite is never resurrected. */
  revoke: underwriterProcedure
    .input(z.object({ inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("borrower_invites")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("id", input.inviteId)
        .select("id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "FORBIDDEN", message: error.message });
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "invitation not found" });
      return { ok: true };
    }),

  /** Curated status the borrower sees - never the deal's internal status. */
  setPortalStatus: underwriterProcedure
    .input(
      z.object({
        inviteId: z.string().uuid(),
        portalStatus: z.enum(["collecting", "in_review", "complete"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("borrower_invites")
        .update({ portal_status: input.portalStatus })
        .eq("id", input.inviteId)
        .select("id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "FORBIDDEN", message: error.message });
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "invitation not found" });
      return { ok: true };
    }),
});

export const documentRequestsRouter = router({
  forDeal: protectedProcedure
    .input(z.object({ dealId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("document_requests")
        .select("id, invite_id, note, status, created_at, resolved_at")
        .eq("deal_id", input.dealId)
        .order("created_at", { ascending: false });
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return (data ?? []).map((r) => ({
        id: r.id as string,
        inviteId: r.invite_id as string,
        note: r.note as string,
        status: r.status as string,
        createdAt: r.created_at as string,
        resolvedAt: (r.resolved_at as string | null) ?? null,
      }));
    }),

  /** The note is shown verbatim to the borrower - the UI says so plainly. */
  create: underwriterProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        inviteId: z.string().uuid(),
        note: z.string().trim().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("document_requests")
        .insert({
          tenant_id: ctx.profile.tenantId,
          deal_id: input.dealId,
          invite_id: input.inviteId,
          note: input.note,
          requested_by: ctx.profile.id,
        })
        .select("id")
        .maybeSingle();
      if (error) throw new TRPCError({ code: "FORBIDDEN", message: error.message });
      return { requestId: data?.id as string };
    }),

  withdraw: underwriterProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("document_requests")
        .update({ status: "withdrawn", resolved_at: new Date().toISOString() })
        .eq("id", input.requestId);
      if (error) throw new TRPCError({ code: "FORBIDDEN", message: error.message });
      return { ok: true };
    }),
});
