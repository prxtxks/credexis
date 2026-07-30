/**
 * Trigger.dev scheduled task `sweep-orphan-documents` (M13.3, walkthrough
 * P2-3): every 10 minutes, enqueue ingest for documents that never entered
 * the pipeline - above all the borrower portal's uploads, whose deployment
 * deliberately holds no Trigger.dev secret and no deal identifiers. The
 * staff-side worker already holds both, so the loop closes HERE, not by
 * weakening the portal's isolation.
 *
 * Selection lives in ../orphan-sweep.js as a pure function (unit-tested):
 * status `uploaded` + older than the grace window. Ingest marks a document
 * `processing` within seconds, so anything still `uploaded` after grace
 * was orphaned - whether by the portal (by design) or by a web-route
 * enqueue failure (by accident); the sweeper rescues both.
 *
 * Boundaries, in the house style:
 * - Per-document idempotency keys: a rerun cannot double-enqueue the same
 *   document while the key lives; ingest's own monotonic status writes
 *   tolerate the rest.
 * - Every failure is LOGGED and skipped - one bad row must not strand the
 *   batch behind it.
 * - Bounded batch (cap in orphan-sweep.ts): a backlog drains across runs.
 * - B4 posture: service-role client, worker-side only, explicit values
 *   read off the rows themselves.
 */

import { schedules, tasks } from "@trigger.dev/sdk";
import * as Sentry from "@sentry/node";
import { selectOrphans, type SweepableDocument } from "../orphan-sweep.js";
import { logEvent, type LogContext } from "../log.js";
import { serviceClient } from "../supabase.js";

export const sweepOrphanDocuments = schedules.task({
  id: "sweep-orphan-documents",
  cron: "*/10 * * * *",
  maxDuration: 120,
  run: async () => {
    const log: LogContext = { task: "sweep-orphan-documents" };
    const dsn = process.env["SENTRY_DSN"];
    if (dsn && !Sentry.isInitialized()) {
      Sentry.init({ dsn, environment: "pipeline", sendDefaultPii: false });
    }
    const client = serviceClient();

    // Server-side prefilter; the pure function re-applies the full rule.
    const { data, error } = await client
      .from("documents")
      .select("id, tenant_id, deal_id, status, created_at")
      .eq("status", "uploaded")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      logEvent(log, "sweep-query-failed", { error: error.message.slice(0, 200) });
      Sentry.captureMessage(`sweep-orphan-documents query failed: ${error.message}`);
      return { swept: 0 };
    }

    const rows: SweepableDocument[] = (data ?? []).map((r) => ({
      id: r.id as string,
      tenantId: r.tenant_id as string,
      dealId: r.deal_id as string,
      status: r.status as string,
      createdAt: r.created_at as string,
    }));
    const orphans = selectOrphans(rows, new Date());
    if (orphans.length === 0) {
      logEvent(log, "sweep-empty");
      return { swept: 0 };
    }

    let swept = 0;
    for (const doc of orphans) {
      try {
        await tasks.trigger(
          "ingest-document",
          { documentId: doc.id, tenantId: doc.tenantId, dealId: doc.dealId },
          { idempotencyKey: `ingest-sweep-${doc.id}` },
        );
        swept += 1;
        logEvent(log, "sweep-enqueued", { documentId: doc.id, dealId: doc.dealId });
      } catch (e) {
        logEvent(log, "sweep-enqueue-failed", {
          documentId: doc.id,
          error: (e as Error).message.slice(0, 200),
        });
        Sentry.captureException(e);
      }
    }
    logEvent(log, "sweep-done", { swept, candidates: orphans.length });
    return { swept };
  },
});
