/**
 * Fact write planner (M4.5, Blueprint §5) — the PURE core of the fact
 * writer: given a reconciliation result and the facts that already exist
 * for this (entity, period, logical document), decide exactly what to
 * insert and what to supersede. The pipeline's DB executor (Trigger.dev,
 * M3.1) applies the plan verbatim.
 *
 * The iron rules this file exists to enforce (append-mostly, Iron Law #5):
 * 1. Re-runs SUPERSEDE prior suggested facts — they never mutate or delete.
 * 2. accepted / overridden facts are NEVER touched: a human decision
 *    outranks any re-extraction, forever.
 * 3. Facts are written ONLY for consensus outcomes with full lineage —
 *    review-lane outcomes produce review candidates, not facts.
 * 4. Idempotence: re-planning the same consensus over its own output is a
 *    no-op.
 */

import type { Cents } from "@credexis/shared";
import type { Bbox } from "../types.js";
import type { RegistryEntry } from "../registry/types.js";
import type { ReconcileResult } from "../consensus/reconcile.js";

/** What the planner needs to know about a fact already in the DB. */
export interface ExistingFact {
  id: string;
  taxonomyNodeKey: string;
  registryFieldId: string | null;
  valueCents: Cents;
  status: "suggested" | "accepted" | "overridden" | "rejected";
  supersededBy: string | null;
}

export interface FactInsert {
  taxonomyNodeKey: string;
  registryFieldId: string;
  valueCents: Cents;
  sourcePage: number | null;
  sourceBbox: Bbox | null;
  method: "consensus";
  confidence: number;
}

export interface WritePlan {
  inserts: FactInsert[];
  /** Prior suggested-fact ids to mark superseded (paired by array order
   *  with `inserts` where `supersedes[i]` belongs to `inserts[i]`; null =
   *  brand-new fact). */
  supersedes: (string | null)[];
  /** Field ids that produced review candidates instead of facts. */
  reviewFieldIds: string[];
  /** Field ids skipped because a human already decided (rule 2). */
  humanDecidedFieldIds: string[];
}

export function planFactWrites(
  reconciled: ReconcileResult,
  entry: RegistryEntry,
  existing: ExistingFact[],
): WritePlan {
  const nodeByField = new Map<string, string>();
  for (const f of entry.fields) {
    if (f.taxonomyNodeKey !== null) nodeByField.set(f.fieldId, f.taxonomyNodeKey);
  }

  // Live (non-superseded) facts by registry field id.
  const live = existing.filter((f) => f.supersededBy === null);
  const humanByField = new Map(
    live
      .filter((f) => f.status === "accepted" || f.status === "overridden")
      .filter((f) => f.registryFieldId !== null)
      .map((f) => [f.registryFieldId as string, f]),
  );
  const suggestedByField = new Map(
    live
      .filter((f) => f.status === "suggested")
      .filter((f) => f.registryFieldId !== null)
      .map((f) => [f.registryFieldId as string, f]),
  );

  const plan: WritePlan = {
    inserts: [],
    supersedes: [],
    reviewFieldIds: [],
    humanDecidedFieldIds: [],
  };

  for (const field of reconciled.fields) {
    // Rule 2: a human decision on this field ends the conversation.
    if (humanByField.has(field.fieldId)) {
      plan.humanDecidedFieldIds.push(field.fieldId);
      continue;
    }

    // Rule 3: only consensus writes facts; everything else is review-lane.
    // (implicatedByRelation stays a fact attribute for the gate engine —
    // the fact is written, G-gates decide auto-accept, M6.1.)
    if (field.outcome !== "consensus" || field.valueCents === null) {
      if (field.outcome !== "consensus_absent") plan.reviewFieldIds.push(field.fieldId);
      continue;
    }

    const node = nodeByField.get(field.fieldId);
    if (node === undefined) continue; // line has no canonical home (subtotal-only lines)

    const prior = suggestedByField.get(field.fieldId);
    // Rule 4: identical value re-extracted → no-op, keep the existing fact.
    if (prior && prior.valueCents === field.valueCents) continue;

    plan.inserts.push({
      taxonomyNodeKey: node,
      registryFieldId: field.fieldId,
      valueCents: field.valueCents,
      sourcePage: field.page,
      sourceBbox: field.bbox,
      method: "consensus",
      confidence: field.confidence,
    });
    // Rule 1: a changed value supersedes the prior suggestion.
    plan.supersedes.push(prior ? prior.id : null);
  }

  return plan;
}
