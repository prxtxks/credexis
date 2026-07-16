/**
 * Review queue logic (M6.3, Blueprint §4.6) — the pure core of the queue.
 * Ordering, progress, and supersession construction live here (unit-tested);
 * the tRPC router is a thin audited wrapper. Corrections NEVER mutate the
 * original fact (Iron Law #5): they insert a new override fact and mark the
 * old one superseded.
 */

export type IssueSeverity = "info" | "warning" | "error" | "critical";

export interface QueueFact {
  id: string;
  logicalDocumentId: string | null;
  sourcePage: number | null;
  createdAt: string; // ISO
}

export interface QueueIssueRef {
  severity: IssueSeverity;
  factIds: string[];
}

const SEVERITY_RANK: Record<IssueSeverity, number> = {
  critical: 3,
  error: 2,
  warning: 1,
  info: 0,
};

export interface OrderedQueueItem extends QueueFact {
  /** Highest severity of any issue implicating this fact (null = none). */
  topSeverity: IssueSeverity | null;
}

/**
 * Next-item ordering (task M6.3): severity first (critical → …), then
 * document order (logical document, page, creation) — so a reviewer burns
 * down the dangerous items before the merely-uncertain ones.
 */
export function orderQueue(facts: QueueFact[], issues: QueueIssueRef[]): OrderedQueueItem[] {
  const severityByFact = new Map<string, IssueSeverity>();
  for (const issue of issues) {
    for (const id of issue.factIds) {
      const cur = severityByFact.get(id);
      if (!cur || SEVERITY_RANK[issue.severity] > SEVERITY_RANK[cur]) {
        severityByFact.set(id, issue.severity);
      }
    }
  }

  return facts
    .map((f) => ({ ...f, topSeverity: severityByFact.get(f.id) ?? null }))
    .sort((a, b) => {
      const sa = a.topSeverity ? SEVERITY_RANK[a.topSeverity] : -1;
      const sb = b.topSeverity ? SEVERITY_RANK[b.topSeverity] : -1;
      if (sa !== sb) return sb - sa; // higher severity first
      const da = a.logicalDocumentId ?? "";
      const db = b.logicalDocumentId ?? "";
      if (da !== db) return da < db ? -1 : 1;
      const pa = a.sourcePage ?? 0;
      const pb = b.sourcePage ?? 0;
      if (pa !== pb) return pa - pb;
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
}

/* ── correction → supersession (Iron Law #5) ─────────────────────────── */

/** The columns a correction copies verbatim from the fact it supersedes. */
export interface SupersedableFact {
  id: string;
  tenant_id: string;
  deal_id: string;
  entity_id: string;
  period_id: string;
  taxonomy_node_key: string;
  registry_field_id: string | null;
  value_cents: string | number | bigint; // as PostgREST returns it
  status: string;
  source_logical_document_id: string | null;
  source_page: number | null;
  source_bbox: unknown;
}

export interface SupersessionPlan {
  /** Row to INSERT: the override fact. */
  insert: Record<string, unknown>;
  /** Values to PATCH onto the old fact (conditioned on status=suggested). */
  patch: { status: "overridden" };
}

const INT_RE = /^-?\d+$/;

/**
 * Build the insert+patch pair for a correction. Throws on anything that
 * would corrupt lineage — the router turns these into BAD_REQUEST.
 */
export function buildSupersession(
  oldFact: SupersedableFact,
  correctedCents: string,
  userId: string,
  note?: string,
): SupersessionPlan {
  if (oldFact.status !== "suggested") {
    throw new Error(`only suggested facts are correctable in review (got "${oldFact.status}")`);
  }
  if (!INT_RE.test(correctedCents)) {
    throw new Error(`corrected value must be integer cents as a string (got "${correctedCents}")`);
  }
  const original = BigInt(oldFact.value_cents.toString());
  const corrected = BigInt(correctedCents);

  return {
    insert: {
      tenant_id: oldFact.tenant_id,
      deal_id: oldFact.deal_id,
      entity_id: oldFact.entity_id,
      period_id: oldFact.period_id,
      taxonomy_node_key: oldFact.taxonomy_node_key,
      registry_field_id: oldFact.registry_field_id,
      value_cents: corrected.toString(),
      // Human input IS the source (Blueprint §5); the original's lineage
      // stays on the superseded row, reachable via superseded_by.
      source_logical_document_id: oldFact.source_logical_document_id,
      source_page: oldFact.source_page,
      source_bbox: oldFact.source_bbox,
      method: "override",
      confidence: 1,
      status: "accepted",
      original_value_cents: original.toString(),
      created_by: userId,
      ...(note ? { note } : {}),
    },
    patch: { status: "overridden" },
  };
}

/* ── progress ────────────────────────────────────────────────────────── */

export interface ProgressCounts {
  suggested: number;
  accepted: number;
  overridden: number;
  rejected: number;
}

/** "14 of 22 fields need review" (Blueprint §8.2). */
export function summarizeProgress(counts: ProgressCounts): {
  total: number;
  remaining: number;
  done: number;
  label: string;
} {
  const total = counts.suggested + counts.accepted + counts.overridden + counts.rejected;
  const remaining = counts.suggested;
  return {
    total,
    remaining,
    done: total - remaining,
    label: `${remaining} of ${total} fields need review`,
  };
}
