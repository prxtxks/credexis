/**
 * Document-identity selection + entity matching (M11.6, design 02 §3).
 * The readers LOCATE the printed name (identity registry fields, dtype
 * text); everything here is deterministic: pick the best-sourced
 * candidate, then score it against the deal's entities with the
 * packages/shared matcher. Identities never become facts.
 */

import { matchBusinessName, matchPersonName, type NameMatchBand } from "@credexis/shared";
import type { FieldCandidate } from "../types.js";

/** Registry identity fields, person vs business semantics. */
export const PERSON_IDENTITY_FIELDS = new Set(["f1040.taxpayer_name", "k1s.shareholder_name"]);
export const BUSINESS_IDENTITY_FIELDS = new Set([
  "f1120s.corp_name",
  "f1120.corp_name",
  "f1065.partnership_name",
]);

const PERSON_ENTITY_KINDS = new Set(["guarantor", "spouse"]);

export interface ExtractedIdentity {
  fieldId: string;
  name: string;
  page: number | null;
  /** Which reader located it (lineage): vendor | llm. */
  method: "vendor" | "llm";
  kind: "person" | "business";
}

/** Vendor first (geometry lineage), LLM fallback; ignores junk (<3 chars). */
export function pickIdentity(
  path1: FieldCandidate[],
  path2: FieldCandidate[],
): ExtractedIdentity | null {
  const all = new Set([...PERSON_IDENTITY_FIELDS, ...BUSINESS_IDENTITY_FIELDS]);
  for (const [cands, method] of [
    [path1, "vendor"],
    [path2, "llm"],
  ] as const) {
    for (const c of cands) {
      if (!all.has(c.fieldId)) continue;
      const name = (c.valueText ?? "").trim();
      if (name.length < 3) continue;
      return {
        fieldId: c.fieldId,
        name,
        page: c.page,
        method,
        kind: PERSON_IDENTITY_FIELDS.has(c.fieldId) ? "person" : "business",
      };
    }
  }
  return null;
}

export interface EntityForMatch {
  id: string;
  name: string;
  kind: string;
}

export interface IdentityMatchResult {
  entityId: string | null;
  /** Basis points (0–10000) — integer, DB-friendly, display-ready. */
  scoreBps: number;
  band: NameMatchBand;
}

/**
 * Best entity for the extracted identity. Person identities score against
 * person-kind entities, business identities against business-kind — when
 * the deal has no entity of the matching kind, ALL entities are scored
 * (a solo-guarantor deal may hold only the business, and vice versa).
 */
export function matchDocumentEntities(
  identity: ExtractedIdentity,
  entities: EntityForMatch[],
): IdentityMatchResult {
  if (entities.length === 0) return { entityId: null, scoreBps: 0, band: "low" };
  const preferred = entities.filter((e) =>
    identity.kind === "person" ? PERSON_ENTITY_KINDS.has(e.kind) : !PERSON_ENTITY_KINDS.has(e.kind),
  );
  const pool = preferred.length > 0 ? preferred : entities;
  const matcher = identity.kind === "person" ? matchPersonName : matchBusinessName;

  let best: IdentityMatchResult = { entityId: null, scoreBps: 0, band: "low" };
  for (const e of pool) {
    const m = matcher(identity.name, e.name);
    const bps = Math.round(m.score * 10000);
    if (bps > best.scoreBps) best = { entityId: e.id, scoreBps: bps, band: m.band };
  }
  return best;
}
