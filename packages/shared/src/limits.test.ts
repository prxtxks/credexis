import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEAL_LIMIT_DEFAULTS,
  INVITE_LIMIT_DEFAULTS,
  resolveDealLimits,
  resolveInviteLimits,
} from "./limits.js";

/** Values a hostile or corrupt settings blob can carry. None may disable a limit. */
const MALFORMED = [
  0,
  -1,
  -0,
  1.5,
  "25",
  "",
  null,
  true,
  false,
  [],
  {},
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  25n, // bigint: never present in jsonb, and jsonb NUMBER is what SQL accepts
];

describe("resolveDealLimits", () => {
  it("empty/absent settings → defaults", () => {
    expect(resolveDealLimits({})).toEqual(DEAL_LIMIT_DEFAULTS);
    expect(resolveDealLimits(null)).toEqual(DEAL_LIMIT_DEFAULTS);
    expect(resolveDealLimits(undefined)).toEqual(DEAL_LIMIT_DEFAULTS);
  });

  it("valid overrides are honored", () => {
    const r = resolveDealLimits({
      limits: { maxDocsPerDeal: 5, maxBytesPerDeal: 1000, maxCostMicroUsdPerDeal: 2_000_000 },
    });
    expect(r).toEqual({
      maxDocsPerDeal: 5,
      maxBytesPerDeal: 1000,
      maxCostMicroUsdPerDeal: 2_000_000n,
    });
  });

  it("malformed overrides can never turn limits off", () => {
    for (const bad of [0, -1, 1.5, "60", null, true, [], {}]) {
      const r = resolveDealLimits({
        limits: { maxDocsPerDeal: bad, maxBytesPerDeal: bad, maxCostMicroUsdPerDeal: bad },
      });
      expect(r).toEqual(DEAL_LIMIT_DEFAULTS);
    }
    expect(resolveDealLimits({ limits: "nope" })).toEqual(DEAL_LIMIT_DEFAULTS);
    expect(resolveDealLimits("garbage")).toEqual(DEAL_LIMIT_DEFAULTS);
  });
});

describe("resolveInviteLimits", () => {
  it("empty/absent settings → defaults", () => {
    expect(resolveInviteLimits({})).toEqual(INVITE_LIMIT_DEFAULTS);
    expect(resolveInviteLimits({ limits: {} })).toEqual(INVITE_LIMIT_DEFAULTS);
    expect(resolveInviteLimits(null)).toEqual(INVITE_LIMIT_DEFAULTS);
    expect(resolveInviteLimits(undefined)).toEqual(INVITE_LIMIT_DEFAULTS);
  });

  it("documented defaults (design §4.5) — the SQL mirror depends on these", () => {
    expect(INVITE_LIMIT_DEFAULTS).toEqual({
      maxDocsPerInvite: 25,
      maxBytesPerInvite: 268_435_456, // 256 MiB
      maxDocsPerInviteHour: 10,
      maxCostMicroUsdPerInvite: 2_500_000n, // micro-USD, bigint (Iron Law #2)
    });
    expect(typeof INVITE_LIMIT_DEFAULTS.maxCostMicroUsdPerInvite).toBe("bigint");
  });

  it("invite ceilings sit under the deal ceilings", () => {
    // If an invite were allowed more than its deal, the tighter surface would
    // be the looser one and the deal ceiling would be unreachable.
    expect(INVITE_LIMIT_DEFAULTS.maxDocsPerInvite).toBeLessThan(DEAL_LIMIT_DEFAULTS.maxDocsPerDeal);
    expect(INVITE_LIMIT_DEFAULTS.maxBytesPerInvite).toBeLessThan(
      DEAL_LIMIT_DEFAULTS.maxBytesPerDeal,
    );
    expect(INVITE_LIMIT_DEFAULTS.maxCostMicroUsdPerInvite).toBeLessThan(
      DEAL_LIMIT_DEFAULTS.maxCostMicroUsdPerDeal,
    );
    expect(INVITE_LIMIT_DEFAULTS.maxDocsPerInviteHour).toBeLessThanOrEqual(
      INVITE_LIMIT_DEFAULTS.maxDocsPerInvite,
    );
  });

  it("valid overrides are honored", () => {
    const r = resolveInviteLimits({
      limits: {
        maxDocsPerInvite: 5,
        maxBytesPerInvite: 1000,
        maxDocsPerInviteHour: 2,
        maxCostMicroUsdPerInvite: 500_000,
      },
    });
    expect(r).toEqual({
      maxDocsPerInvite: 5,
      maxBytesPerInvite: 1000,
      maxDocsPerInviteHour: 2,
      maxCostMicroUsdPerInvite: 500_000n,
    });
  });

  it("one bad key never poisons the others", () => {
    const r = resolveInviteLimits({ limits: { maxDocsPerInvite: 0, maxBytesPerInvite: 1000 } });
    expect(r.maxDocsPerInvite).toBe(INVITE_LIMIT_DEFAULTS.maxDocsPerInvite);
    expect(r.maxBytesPerInvite).toBe(1000);
  });

  it("malformed overrides can never turn limits off", () => {
    for (const bad of MALFORMED) {
      const r = resolveInviteLimits({
        limits: {
          maxDocsPerInvite: bad,
          maxBytesPerInvite: bad,
          maxDocsPerInviteHour: bad,
          maxCostMicroUsdPerInvite: bad,
        },
      });
      expect(r, `malformed value must fall back: ${String(bad)}`).toEqual(INVITE_LIMIT_DEFAULTS);
    }
    expect(resolveInviteLimits({ limits: "nope" })).toEqual(INVITE_LIMIT_DEFAULTS);
    expect(resolveInviteLimits({ limits: [] })).toEqual(INVITE_LIMIT_DEFAULTS);
    expect(resolveInviteLimits({ limits: null })).toEqual(INVITE_LIMIT_DEFAULTS);
    expect(resolveInviteLimits("garbage")).toEqual(INVITE_LIMIT_DEFAULTS);
    expect(resolveInviteLimits([])).toEqual(INVITE_LIMIT_DEFAULTS);
    expect(resolveInviteLimits(42)).toEqual(INVITE_LIMIT_DEFAULTS);
  });

  it("deal keys and invite keys do not read each other's names", () => {
    // A settings blob that overrides only the deal keys must leave the invite
    // limits at their defaults, and vice versa — the two namespaces are
    // separate on purpose (a generous deal ceiling is not a borrower's).
    const dealOnly = {
      limits: { maxDocsPerDeal: 1, maxBytesPerDeal: 1, maxCostMicroUsdPerDeal: 1 },
    };
    expect(resolveInviteLimits(dealOnly)).toEqual(INVITE_LIMIT_DEFAULTS);
    const inviteOnly = {
      limits: { maxDocsPerInvite: 1, maxBytesPerInvite: 1, maxCostMicroUsdPerInvite: 1 },
    };
    expect(resolveDealLimits(inviteOnly)).toEqual(DEAL_LIMIT_DEFAULTS);
  });

  it("parses identically to resolveDealLimits (no drift between the two)", () => {
    // Same envelope shapes, same verdict: both resolvers must accept and
    // reject exactly the same settings blobs.
    const envelopes: unknown[] = [
      undefined,
      null,
      "garbage",
      42,
      [],
      {},
      { limits: null },
      { limits: "nope" },
      { limits: [] },
      { limits: {} },
      ...MALFORMED.map((bad) => ({
        limits: { maxDocsPerDeal: bad, maxDocsPerInvite: bad },
      })),
    ];
    for (const settings of envelopes) {
      // A bigint in the blob would make JSON.stringify throw, so labels are
      // built the boring way.
      const label = String(
        settings === null || typeof settings !== "object"
          ? settings
          : Object.values((settings as { limits?: unknown }).limits ?? {}).map(String),
      );
      const deal = resolveDealLimits(settings);
      const invite = resolveInviteLimits(settings);
      expect(deal.maxDocsPerDeal, `deal: ${label}`).toBe(DEAL_LIMIT_DEFAULTS.maxDocsPerDeal);
      expect(invite.maxDocsPerInvite, `invite: ${label}`).toBe(
        INVITE_LIMIT_DEFAULTS.maxDocsPerInvite,
      );
    }
    // …and both honour the same valid shape.
    expect(resolveDealLimits({ limits: { maxDocsPerDeal: 7 } }).maxDocsPerDeal).toBe(7);
    expect(resolveInviteLimits({ limits: { maxDocsPerInvite: 7 } }).maxDocsPerInvite).toBe(7);
  });
});

describe("SQL mirror (migration 0029)", () => {
  const SQL = readFileSync(
    fileURLToPath(new URL("../../schema/drizzle/0029_borrower-access-path.sql", import.meta.url)),
    "utf8",
  );

  it("settings_limit() still accepts only positive integers", () => {
    // The SQL side's guard: jsonb NUMBER and `^[1-9][0-9]*$`. Same contract as
    // positiveInt() here — 0, negatives and decimals fall back to the default.
    expect(SQL).toContain("jsonb_typeof(v) = 'number'");
    expect(SQL).toContain("'^[1-9][0-9]*$'");
  });

  it("the SQL default for maxDocsPerInvite equals INVITE_LIMIT_DEFAULTS", () => {
    // 0029 §d hardcodes the fallback inside borrower_object_budget_ok; if this
    // file's default moves and that one does not, the storage policy and the
    // app disagree about how many files an invite may hold.
    const m = SQL.match(/settings_limit\(\s*t\.settings,\s*'maxDocsPerInvite',\s*(\d+)\s*\)/);
    expect(m, "0029 no longer resolves maxDocsPerInvite via settings_limit").not.toBeNull();
    expect(Number(m?.[1])).toBe(INVITE_LIMIT_DEFAULTS.maxDocsPerInvite);
  });
});
