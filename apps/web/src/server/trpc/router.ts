import { protectedProcedure, publicProcedure, router } from "./init";
import { documentsRouter } from "./routers/documents";
import { reviewRouter } from "./routers/review";

/**
 * Application router (M2.3). Grows with the product; today it carries the
 * auth surface the workspace shell needs.
 */
export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true }) as const),

  /** Who am I: verified identity + tenant + role for the signed-in caller. */
  me: protectedProcedure.query(({ ctx }) => ({
    userId: ctx.profile.id,
    email: ctx.profile.email,
    tenantId: ctx.profile.tenantId,
    role: ctx.profile.role,
  })),

  /** Deal documents (M3.1): uploads + pipeline status. */
  documents: documentsRouter,

  /** Review queue (M6.3): ordered items + audited accept/correct/reject. */
  review: reviewRouter,
});

export type AppRouter = typeof appRouter;
