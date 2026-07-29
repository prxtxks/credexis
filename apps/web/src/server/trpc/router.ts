import { protectedProcedure, publicProcedure, router } from "./init";
import { addbacksRouter } from "./routers/addbacks";
import { assignmentRouter, identitiesRouter } from "./routers/assignment";
import { auditRouter } from "./routers/audit";
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
import { invitesRouter, membersRouter, orgRouter } from "./routers/org";
import { notificationsRouter } from "./routers/notifications";
import { profileRouter } from "./routers/profile";
import { borrowerInvitesRouter, borrowersRouter, documentRequestsRouter } from "./routers/borrower";

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

  /** Members & invites (M11.3): delegated access on the tier lattice. */
  members: membersRouter,
  invites: invitesRouter,

  /** Notification center (M11.5): self-scoped reads + state changes. */
  notifications: notificationsRouter,

  /** Entity↔document identity matches (M11.6). */
  identities: identitiesRouter,

  /** Self profile + email preferences (M11.7): self-scoped via definer. */
  profile: profileRouter,

  /** Audit trail + hash-chain verification (M12.3): reads through RLS. */
  audit: auditRouter,

  /** Borrower portal, broker side (M12.1). */
  borrowers: borrowersRouter,
  borrowerInvites: borrowerInvitesRouter,
  documentRequests: documentRequestsRouter,
});

export type AppRouter = typeof appRouter;
