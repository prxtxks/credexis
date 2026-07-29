import { protectedProcedure, publicProcedure, router } from "./init";
import { addbacksRouter } from "./routers/addbacks";
import { assignmentRouter } from "./routers/assignment";
import { dealsRouter } from "./routers/deals";
import { documentsRouter } from "./routers/documents";
import { issuesRouter } from "./routers/issues";
import { metricsRouter } from "./routers/metrics";
import { pipelineRouter } from "./routers/pipeline";
import { policyRouter } from "./routers/policy";
import { reviewRouter } from "./routers/review";
import { sourceRouter } from "./routers/source";
import { spreadRouter } from "./routers/spread";
import { transcriptsRouter } from "./routers/transcripts";
import { orgRouter } from "./routers/org";

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

  /** Source viewer (M8.4): lineage + signed PDF URL + override/revert. */
  source: sourceRouter,

  /** Issues (M8.5): open gate violations for the workspace panel. */
  issues: issuesRouter,

  /** Policy compliance (M8.6): the deal's pinned pack vs engine output. */
  policy: policyRouter,

  /** Pipeline progress (M8.8): stage timeline per document. */
  pipeline: pipelineRouter,

  /** IRS transcripts (M9): flag, consents, ingest — graceful absence. */
  transcripts: transcriptsRouter,

  /** Org bootstrap (M11.2): signup → create org → org_owner. */
  org: orgRouter,
});

export type AppRouter = typeof appRouter;
