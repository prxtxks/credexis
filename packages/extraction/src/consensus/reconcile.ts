/**
 * Consensus reconciler (M4.4, Blueprint §4.2) — deterministic, the core
 * precision mechanism: two INDEPENDENT extractors' candidates compared
 * field-by-field; agreement ⇒ high-confidence consensus, anything else ⇒
 * review. Registry cross-field relations run as a third signal.
 *
 * "Independent-extractor agreement is the honest route to 99%: two
 * ~96%-accurate extractors that fail differently yield agreement-filtered
 * precision well above 99%, with the disagreeing ~5–8% routed to a human."
 *
 * No LLM here, no floats near money, no guessing: this file is pure
 * functions over already-extracted candidates.
 */

import { normalizeAmount, type Cents, type NormalizeResult } from "@credexis/shared";
import type { Bbox, FieldCandidate } from "../types.js";
import type { InFormRelation, RegistryEntry } from "../registry/types.js";

/** A path's candidate after the ONE normalizer has seen it. */
export interface NormalizedCandidate {
  rawText: string | null;
  /** Integer cents; null = field absent/blank on the document. */
  cents: Cents | null;
  /** Set when the raw text failed normalization (routes to review). */
  normalizationError: string | null;
  page: number | null;
  bbox: Bbox | null;
  confidence: number;
}

export type ReconcileOutcome =
  | "consensus" // both paths agree on a value → auto-accept candidate
  | "consensus_absent" // both paths agree the field is blank
  | "disagreement" // both read values, values differ → review
  | "single_source" // exactly one path produced a value → review
  | "unreadable"; // normalization failed on what a path read → review

export interface ReconciledField {
  fieldId: string;
  outcome: ReconcileOutcome;
  /** Populated ONLY on consensus — never on any review outcome. */
  valueCents: Cents | null;
  /** Geometry lineage comes from Path 1 (the layout vendor). */
  page: number | null;
  bbox: Bbox | null;
  confidence: number;
  /** True when a violated registry relation implicates this field. */
  implicatedByRelation: boolean;
  path1: NormalizedCandidate | null;
  path2: NormalizedCandidate | null;
}

export interface RelationCheck {
  relationId: string;
  status: "passed" | "violated" | "skipped";
  /** |computed − stated| in cents (0n when passed exactly). */
  deltaCents: bigint;
  fieldIds: string[];
  description: string;
}

export interface ReconcileResult {
  fields: ReconciledField[];
  relationChecks: RelationCheck[];
}

/** Normalize one path's candidates against the registry's cents-box flags. */
export function normalizeCandidates(
  candidates: FieldCandidate[],
  entry: RegistryEntry,
): Map<string, NormalizedCandidate> {
  const centsBoxById = new Map(entry.fields.map((f) => [f.fieldId, f.hasCentsBox]));
  const out = new Map<string, NormalizedCandidate>();
  for (const c of candidates) {
    let cents: Cents | null = null;
    let normalizationError: string | null = null;
    if (c.valueText !== null) {
      const r: NormalizeResult = normalizeAmount(c.valueText, {
        ...(centsBoxById.get(c.fieldId) && c.centsBoxText !== undefined && c.centsBoxText !== null
          ? { centsBox: c.centsBoxText }
          : {}),
      });
      if (r.ok) {
        cents = r.cents;
      } else {
        normalizationError = r.reason;
      }
    }
    out.set(c.fieldId, {
      rawText: c.valueText,
      cents,
      normalizationError,
      page: c.page,
      bbox: c.bbox,
      confidence: c.confidence,
    });
  }
  return out;
}

function reconcileField(
  fieldId: string,
  p1: NormalizedCandidate | null,
  p2: NormalizedCandidate | null,
): ReconciledField {
  const base = {
    fieldId,
    page: p1?.page ?? p2?.page ?? null,
    bbox: p1?.bbox ?? null, // geometry only ever from Path 1
    implicatedByRelation: false,
    path1: p1,
    path2: p2,
  };

  // Normalization failure on either side is its own review lane — a human
  // must see what the extractor saw.
  if (p1?.normalizationError || p2?.normalizationError) {
    return { ...base, outcome: "unreadable", valueCents: null, confidence: 0 };
  }

  const v1 = p1?.cents ?? null;
  const v2 = p2?.cents ?? null;

  if (v1 !== null && v2 !== null) {
    if (v1 === v2) {
      return {
        ...base,
        outcome: "consensus",
        valueCents: v1,
        confidence: Math.min(p1?.confidence ?? 0, p2?.confidence ?? 0),
      };
    }
    return { ...base, outcome: "disagreement", valueCents: null, confidence: 0 };
  }

  if (v1 === null && v2 === null) {
    // Both paths read the document and both say blank — that agreement is
    // real signal (null-vs-zero disambiguation happened upstream).
    const bothReported = p1 !== null && p2 !== null;
    return {
      ...base,
      outcome: bothReported ? "consensus_absent" : "single_source",
      valueCents: null,
      confidence: bothReported ? Math.min(p1.confidence, p2.confidence) : 0,
    };
  }

  return { ...base, outcome: "single_source", valueCents: null, confidence: 0 };
}

/**
 * Relation math uses PRINTED values exactly as reconciled — the registry
 * `sign` field is a fact-aggregation concern (M4.5+), not relation math:
 * `difference` = operands[0] − operands[1] − …; `sum` = Σ operands.
 */
function checkRelation(rel: InFormRelation, byId: Map<string, ReconciledField>): RelationCheck {
  const fieldIds = [rel.result, ...rel.operands];
  const values = new Map<string, Cents>();
  for (const id of fieldIds) {
    const f = byId.get(id);
    // consensus_absent participates as 0 (a blank IRS line means zero for
    // arithmetic); anything unresolved skips the check.
    if (f?.outcome === "consensus" && f.valueCents !== null) {
      values.set(id, f.valueCents);
    } else if (f?.outcome === "consensus_absent") {
      values.set(id, 0n as Cents);
    }
  }
  if (values.size !== fieldIds.length) {
    return {
      relationId: rel.id,
      status: "skipped",
      deltaCents: 0n,
      fieldIds,
      description: rel.description,
    };
  }

  let computed = 0n;
  if (rel.type === "sum") {
    for (const op of rel.operands) computed += values.get(op) ?? 0n;
  } else {
    const [first, ...rest] = rel.operands;
    computed = values.get(first ?? "") ?? 0n;
    for (const op of rest) computed -= values.get(op) ?? 0n;
  }
  const stated = values.get(rel.result) ?? 0n;
  const delta = computed > stated ? computed - stated : stated - computed;

  return {
    relationId: rel.id,
    status: delta <= rel.toleranceCents ? "passed" : "violated",
    deltaCents: delta,
    fieldIds,
    description: rel.description,
  };
}

/**
 * The reconciler. Path order matters only for lineage: Path 1 is the
 * geometry-bearing vendor, Path 2 the vision LLM (Blueprint §4.2).
 */
export function reconcile(
  path1: FieldCandidate[],
  path2: FieldCandidate[],
  entry: RegistryEntry,
): ReconcileResult {
  const n1 = normalizeCandidates(path1, entry);
  const n2 = normalizeCandidates(path2, entry);

  const fields = entry.fields.map((f) =>
    reconcileField(f.fieldId, n1.get(f.fieldId) ?? null, n2.get(f.fieldId) ?? null),
  );
  const byId = new Map(fields.map((f) => [f.fieldId, f]));

  const relationChecks = entry.relations.map((rel) => checkRelation(rel, byId));

  // A violated relation implicates every field it touches: those consensus
  // values may still be wrong-in-agreement — they cannot auto-accept (the
  // blocking semantics land with the gate engine, M6.1; the flag is born here).
  for (const check of relationChecks) {
    if (check.status === "violated") {
      for (const id of check.fieldIds) {
        const f = byId.get(id);
        if (f) f.implicatedByRelation = true;
      }
    }
  }

  return { fields, relationChecks };
}
