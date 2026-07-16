/**
 * Gate engine types (M6.1, Blueprint §4.5). Gates are PURE functions over
 * facts — zero I/O, zero vendor deps. Everything contextual (taxonomy
 * structure, registry relations, thresholds) arrives as DATA so the engine
 * package depends on nothing but @credexis/shared.
 *
 * Blocking semantics (Iron Law #6): a fact implicated by a failing G1–G5
 * issue cannot auto-accept; it must go through the review queue. G6 is
 * flag-only by spec.
 */

export type GateId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6";

export type IssueSeverity = "info" | "warning" | "error" | "critical";

/** The fact shape gates read — mapped from DB rows by the caller. */
export interface GateFact {
  id: string;
  entityId: string;
  /** Canonical period label ("FY2023", "2025-01..2025-06", …). */
  periodLabel: string;
  taxonomyNodeKey: string | null;
  registryFieldId: string | null;
  /** Integer cents (Iron Law #2). */
  valueCents: bigint;
  method: "vendor" | "llm" | "consensus" | "transcript" | "override" | "human";
  status: "suggested" | "accepted" | "overridden" | "rejected";
  /** Groups facts extracted from the same logical document (G3 tie-outs). */
  logicalDocumentId: string | null;
}

export interface GateIssue {
  gate: GateId;
  severity: IssueSeverity;
  /** G1–G5 block auto-accept of implicated facts; G6 never does. */
  blocking: boolean;
  entityId: string;
  periodLabel: string;
  message: string;
  implicatedFactIds: string[];
  deltaCents: bigint;
}

/** Taxonomy structure as data (from @credexis/schema's TAXONOMY_V1). */
export interface TaxonomyNodeRef {
  key: string;
  parentKey: string | null;
}

/** In-form registry relation (from the Form Registry, M4.1). */
export interface RegistryRelationSpec {
  id: string;
  type: "sum" | "difference";
  result: string; // registry field id
  operands: string[];
  toleranceCents: bigint;
  description: string;
}

/** Cross-form flow (4562 line 22 → parent depreciation line, K-1 ↔ parent). */
export interface RegistryFlowSpec {
  id: string;
  fromField: string;
  toField: string;
  toleranceCents: bigint;
  description: string;
}

export interface GateConfig {
  taxonomy: TaxonomyNodeRef[];
  registryRelations: RegistryRelationSpec[];
  registryFlows: RegistryFlowSpec[];
  /** G3: flag when |taxNI − stmtNI| > max(g3FloorCents, |taxNI|·g3Bps/10000). */
  g3FloorCents: bigint;
  g3Bps: bigint;
  /** G6: flag YoY swings beyond this band (bps of the older value). */
  g6BandBps: bigint;
}

export const DEFAULT_GATE_CONFIG: Omit<
  GateConfig,
  "taxonomy" | "registryRelations" | "registryFlows"
> = {
  g3FloorCents: 50_000n, // $500 (Blueprint §4.5)
  g3Bps: 100n, // 1%
  g6BandBps: 20_000n, // 200% YoY swing → temporal-sanity flag
};

export interface GateRunResult {
  issues: GateIssue[];
  /** Union of implicated fact ids across blocking issues (G1–G5). */
  blockedFactIds: Set<string>;
}
