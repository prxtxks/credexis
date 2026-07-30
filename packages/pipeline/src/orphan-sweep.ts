/**
 * Orphan-document selection (M13.3, walkthrough P2-3): pure logic for the
 * staff-side sweeper that rescues documents which never entered the
 * pipeline. The borrower portal's `borrower_attach_upload` inserts the
 * `documents` row but deliberately CANNOT enqueue the ingest task - the
 * borrower deployment holds no Trigger.dev secret and no deal identifiers
 * (the portal's whole security argument). The sweeper closes the loop from
 * the side that already holds both.
 *
 * A document that entered the pipeline is marked `processing` within
 * seconds (ingest.ts); one that never did stays `uploaded`. So the orphan
 * condition is simply: status `uploaded`, older than the grace window.
 * The grace keeps the sweeper from racing the web upload route's own
 * enqueue on the happy path.
 */

export interface SweepableDocument {
  id: string;
  tenantId: string;
  dealId: string;
  status: string;
  createdAt: string;
}

/** Give the web route's own enqueue time to win the happy-path race. */
export const SWEEP_GRACE_MS = 3 * 60_000;

/** Bounded batch per run - a backlog drains across runs, never in one spike. */
export const SWEEP_BATCH_CAP = 20;

export function selectOrphans(
  rows: readonly SweepableDocument[],
  now: Date,
  graceMs: number = SWEEP_GRACE_MS,
  cap: number = SWEEP_BATCH_CAP,
): SweepableDocument[] {
  const cutoff = now.getTime() - graceMs;
  return rows
    .filter((r) => r.status === "uploaded" && Date.parse(r.createdAt) <= cutoff)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, cap);
}
