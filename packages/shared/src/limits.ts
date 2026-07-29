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
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
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

/**
 * Per-invite limits (M12.1 — design §4.5, §7.1). A borrower invite is a
 * narrower and far more hostile surface than a deal: the uploader is outside
 * the tenant and holds a link that may have been forwarded. These sit UNDER
 * the deal ceilings (both are checked; whichever binds first wins) and add a
 * trailing-hour rate cap the deal level has no need for.
 *
 * Mirrored in SQL by `settings_limit()` and the invite branch of
 * `enforce_deal_upload_limits()` (migration 0029 §a/§d, design §7.1) — change
 * BOTH places, same standing note as 0021.
 */
export interface InviteLimits {
  /** Max `documents` rows attributed to one invite. */
  maxDocsPerInvite: number;
  /** Max Σ documents.bytes attributed to one invite. */
  maxBytesPerInvite: number;
  /** Max `documents` rows one invite may create in the trailing hour. */
  maxDocsPerInviteHour: number;
  /** Max Σ extraction_runs.cost_micro_usd over one invite's documents. */
  maxCostMicroUsdPerInvite: bigint;
}

export const INVITE_LIMIT_DEFAULTS: InviteLimits = {
  maxDocsPerInvite: 25,
  maxBytesPerInvite: 268_435_456, // 256 MiB (uploads are individually capped at 50 MiB)
  maxDocsPerInviteHour: 10,
  // $2.50 of the deal's $10 envelope: one borrower — or one forwarded link —
  // must not be able to spend the whole deal's extraction budget.
  maxCostMicroUsdPerInvite: 2_500_000n,
};

/**
 * Resolve effective per-invite limits from a tenants.settings jsonb value.
 * Same contract as resolveDealLimits, deliberately in the same shape so the
 * two cannot drift: NUMBER only, positive integers only, unknown or malformed
 * overrides fall back to defaults — a corrupt settings blob must never turn
 * the limits OFF. (Per-invite `max_docs`/`max_bytes` column overrides are a
 * DB-side coalesce on top of this, not a parse concern.)
 */
export function resolveInviteLimits(settings: unknown): InviteLimits {
  const limits =
    typeof settings === "object" && settings !== null && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)["limits"]
      : null;
  const o =
    typeof limits === "object" && limits !== null && !Array.isArray(limits)
      ? (limits as Record<string, unknown>)
      : {};
  const cost = positiveInt(o["maxCostMicroUsdPerInvite"]);
  return {
    maxDocsPerInvite: positiveInt(o["maxDocsPerInvite"]) ?? INVITE_LIMIT_DEFAULTS.maxDocsPerInvite,
    maxBytesPerInvite:
      positiveInt(o["maxBytesPerInvite"]) ?? INVITE_LIMIT_DEFAULTS.maxBytesPerInvite,
    maxDocsPerInviteHour:
      positiveInt(o["maxDocsPerInviteHour"]) ?? INVITE_LIMIT_DEFAULTS.maxDocsPerInviteHour,
    maxCostMicroUsdPerInvite:
      cost !== null ? BigInt(cost) : INVITE_LIMIT_DEFAULTS.maxCostMicroUsdPerInvite,
  };
}
