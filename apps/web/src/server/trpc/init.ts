import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context, UserRole } from "./context";

/**
 * tRPC initialization + role-tiered procedures (M2.3). Roles are enforced
 * HERE, server-side, from the RLS-loaded profile — never from anything the
 * client sends. superjson transformer carries bigint (cents) losslessly.
 */
const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Signed-in only — profile OPTIONAL (M11.2). For the org-bootstrap seam
 * exclusively: a fresh signup has a session but no profile yet, and
 * `org.create` / `me.bootstrap` must work in that state. Everything else
 * stays on protectedProcedure or stricter.
 */
export const sessionProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "sign in required" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Signed-in AND tenant-assigned (profile row exists). */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "sign in required" });
  }
  if (!ctx.profile) {
    throw new TRPCError({ code: "FORBIDDEN", message: "no workspace assigned to this account" });
  }
  return next({ ctx: { ...ctx, user: ctx.user, profile: ctx.profile } });
});

function requireRole(roles: readonly UserRole[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!roles.includes(ctx.profile.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `requires role: ${roles.join(" or ")}`,
      });
    }
    return next({ ctx });
  });
}

/** Write access: underwriters and above (org_owner ≥ admin, M11.3). */
export const underwriterProcedure = requireRole(["org_owner", "admin", "underwriter"]);

/** Administrative access: org_owner and admin. */
export const adminProcedure = requireRole(["org_owner", "admin"]);
