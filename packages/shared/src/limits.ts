/**
 * Deal-level operational limits (M12.1 — borrower-portal prerequisite).
 * Defaults live here; per-tenant overrides live in tenants.settings.limits
 * (policy-as-data, Iron Law #8 spirit: ops limits are data, not scattered
 * constants). The DB backstop trigger in migration 0021 mirrors the same
 * defaults in SQL — change BOTH places or the belt and braces disagree.
 *
 * These are platform-abuse ceilings, not underwriting policy: generous for
 * legitimate deals (a typical deal is 150–250 pages across 10–20 files),
 * hard walls for runaway or hostile uploaders. Borrower invites (M12) get
 * tighter per-invite quotas ON TOP of these.
 */

export interface DealLimits {
  /** Max `documents` rows per deal. */
  maxDocsPerDeal: number;
  /** Max Σ documents.bytes per deal. */
  maxBytesPerDeal: number;
  /** Max Σ extraction_runs.cost_micro_usd per deal before extraction is withheld. */
  maxCostMicroUsdPerDeal: bigint;
}

export const DEAL_LIMIT_DEFAULTS: DealLimits = {
  maxDocsPerDeal: 60,
  maxBytesPerDeal: 1_073_741_824, // 1 GiB (uploads are individually capped at 50 MiB)
  // Blueprint §12: ≈$5–10 COGS per deal. The envelope the costs page
  // reports against and the ceiling the pipeline enforces are the SAME
  // number on purpose.
  maxCostMicroUsdPerDeal: 10_000_000n, // $10.00
};

function positiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * Resolve effective limits from a tenants.settings jsonb value. Unknown or
 * malformed overrides fall back to defaults — a corrupt settings blob must
 * never turn the limits OFF.
 */
export function resolveDealLimits(settings: unknown): DealLimits {
  const limits =
    typeof settings === "object" && settings !== null && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)["limits"]
      : null;
  const o =
    typeof limits === "object" && limits !== null && !Array.isArray(limits)
      ? (limits as Record<string, unknown>)
      : {};
  const cost = positiveInt(o["maxCostMicroUsdPerDeal"]);
  return {
    maxDocsPerDeal: positiveInt(o["maxDocsPerDeal"]) ?? DEAL_LIMIT_DEFAULTS.maxDocsPerDeal,
    maxBytesPerDeal: positiveInt(o["maxBytesPerDeal"]) ?? DEAL_LIMIT_DEFAULTS.maxBytesPerDeal,
    maxCostMicroUsdPerDeal:
      cost !== null ? BigInt(cost) : DEAL_LIMIT_DEFAULTS.maxCostMicroUsdPerDeal,
  };
}
