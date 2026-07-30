/**
 * Addback flow logic (M7.3). Suggestion generation is the engine's pure
 * rule set; this module holds the persistence-side decisions: which
 * engine suggestions are NEW (a (factId, category) pair that already
 * exists - in ANY state - is never re-created, so a human's rejection
 * stays rejected across refreshes), and safe bigint decoding of DB rows.
 */

import type { AddbackSuggestion } from "@credexis/engine";

export interface ExistingAddbackKey {
  factId: string | null;
  category: string;
}

export function newSuggestions(
  suggestions: AddbackSuggestion[],
  existing: ExistingAddbackKey[],
): AddbackSuggestion[] {
  const seen = new Set(
    existing.filter((e) => e.factId !== null).map((e) => `${e.factId}|${e.category}`),
  );
  return suggestions.filter((s) => !seen.has(`${s.factId}|${s.category}`));
}

/**
 * PostgREST serializes int8 as a JSON number. That is exact up to 2^53
 * (≈ $90 trillion in cents) - far beyond any 7(a) deal - but Iron Law #2
 * demands the boundary be explicit: decode to bigint immediately and fail
 * loudly if a value ever exceeds the safe range instead of silently
 * losing precision.
 */
export function bigintFromDb(value: number | string): bigint {
  if (typeof value === "string") return BigInt(value);
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `bigintFromDb: ${value} exceeds Number.MAX_SAFE_INTEGER - cast ::text in the query`,
    );
  }
  return BigInt(value);
}
