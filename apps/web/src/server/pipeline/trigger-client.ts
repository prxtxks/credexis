/**
 * Pipeline trigger seam (M3.1). The upload path calls this; the actual
 * Trigger.dev task lands in the pipeline package (PR B). Until the task is
 * deployed, uploads succeed and report `pipeline: {triggered: false}` -
 * the document sits in `uploaded` status, and the ingest task can be
 * triggered retroactively for any pending document.
 */

export interface IngestPayload {
  documentId: string;
  tenantId: string;
  dealId: string;
}

export interface TriggerResult {
  triggered: boolean;
  runId?: string;
  reason?: string;
}

const INGEST_TASK_ID = "ingest-document";
const EXTRACT_TASK_ID = "extract-document";

async function triggerTask(
  taskId: string,
  payload: Record<string, string>,
  options?: { idempotencyKey?: string },
): Promise<TriggerResult> {
  const secretKey = process.env["TRIGGER_SECRET_KEY"];
  if (!secretKey) return { triggered: false, reason: "TRIGGER_SECRET_KEY not configured" };

  try {
    const res = await fetch(`https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payload, ...(options ? { options } : {}) }),
    });
    if (!res.ok) {
      // 404 until the task is deployed (needs TRIGGER_ACCESS_TOKEN) -
      // callers must not fail because the pipeline isn't live yet.
      return { triggered: false, reason: `trigger api ${res.status}` };
    }
    const body = (await res.json()) as { id?: string };
    return { triggered: true, ...(body.id ? { runId: body.id } : {}) };
  } catch (e) {
    return { triggered: false, reason: (e as Error).message.slice(0, 120) };
  }
}

export async function triggerIngest(payload: IngestPayload): Promise<TriggerResult> {
  return triggerTask(INGEST_TASK_ID, { ...payload });
}

export interface ExtractPayload {
  tenantId: string;
  dealId: string;
  documentId: string;
  logicalDocumentId: string;
}

/**
 * Extraction for one assigned span (M14.5). The idempotency key is
 * (span, entity): re-assigning the same entity twice is one run; the
 * task's own zero-facts guard covers everything the key cannot.
 */
export async function triggerExtract(
  payload: ExtractPayload,
  entityId: string,
): Promise<TriggerResult> {
  return triggerTask(
    EXTRACT_TASK_ID,
    { ...payload },
    { idempotencyKey: `extract:${payload.logicalDocumentId}:${entityId}` },
  );
}
