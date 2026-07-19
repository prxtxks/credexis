import { protectedProcedure, publicProcedure, router } from "./init";
import { addbacksRouter } from "./routers/addbacks";
import { assignmentRouter } from "./routers/assignment";
import { dealsRouter } from "./routers/deals";
import { documentsRouter } from "./routers/documents";
import { metricsRouter } from "./routers/metrics";
import { reviewRouter } from "./routers/review";
import { spreadRouter } from "./routers/spread";

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

  /** Document assignment (M6.5): confirm/fix Stage-S split suggestions. */
  assignment: assignmentRouter,

  /** Addback flow (M7.3): rule suggestions + audited accept/reject. */
  addbacks: addbacksRouter,

  /** Engine output + scenarios (M7.7): recompute on every mutation. */
  metrics: metricsRouter,

  /** Deals (M8.2 rail / M8.7 dashboard). */
  deals: dealsRouter,

  /** Spread grid (M8.3): taxonomy × periods + computed rows + label learning. */
  spread: spreadRouter,
});

export type AppRouter = typeof appRouter;
