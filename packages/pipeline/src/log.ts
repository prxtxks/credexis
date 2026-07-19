/**
 * Structured logging for pipeline tasks (M10.2): one JSON line per event,
 * always carrying the run/document ids — greppable in Trigger.dev's log
 * viewer and any log drain. Never log document contents or money values
 * beyond what extraction_runs already records.
 */

export interface LogContext {
  task: string;
  runId?: string;
  documentId?: string;
  dealId?: string;
}

export function logEvent(
  ctx: LogContext,
  event: string,
  fields: Record<string, string | number | boolean | null> = {},
): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...ctx,
      ...fields,
    }),
  );
}
