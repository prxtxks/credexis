/**
 * M3.6 acceptance: "Exhaustive table-driven tests (all formats incl. (500),
 * EU separators, thousands-scaling, dash-vs-null)". This suite IS the spec.
 */

import { describe, expect, it } from "vitest";
import { normalizeAmount, type NormalizeOptions } from "./number.js";

const show = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? `${x}n` : x));

function expectCents(raw: string, expected: bigint, opts?: NormalizeOptions) {
  const r = normalizeAmount(raw, opts);
  expect(r.ok, `"${raw}" should parse, got ${show(r)}`).toBe(true);
  if (r.ok) expect(r.cents, `"${raw}"`).toBe(expected);
}

function expectNull(raw: string, nullReason: string) {
  const r = normalizeAmount(raw);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.cents).toBeNull();
    if (r.cents === null) expect(r.nullReason).toBe(nullReason);
  }
}

function expectReject(raw: string, reason: string, opts?: NormalizeOptions) {
  const r = normalizeAmount(raw, opts);
  expect(r.ok, `"${raw}" should be rejected`).toBe(false);
  if (!r.ok) expect(r.reason, `"${raw}"`).toBe(reason);
}

describe("plain and US formats", () => {
  it.each<[string, bigint]>([
    ["10000", 1000000n],
    ["10,000", 1000000n],
    ["10,000.00", 1000000n],
    ["1,234.56", 123456n],
    ["$10,000", 1000000n],
    ["$ 1,234.56", 123456n],
    ["0", 0n],
    ["0.00", 0n],
    ["$0", 0n],
    ["1,234.", 123400n], // trailing decimal point, whole number
    ["1234.", 123400n],
    [".56", 56n], // bare decimal
    ["999", 99900n],
    ["1,234,567.89", 123456789n],
    ["12,345,678", 1234567800n],
  ])("%s → %d¢", (raw, want) => expectCents(raw, want));
});

describe("negatives: parentheses, leading, trailing, unicode", () => {
  it.each<[string, bigint]>([
    ["(500)", -50000n],
    ["(1,234.56)", -123456n],
    ["($1,020.64)", -102064n],
    ["-500", -50000n],
    ["−500", -50000n], // U+2212 minus
    ["–500", -50000n], // en dash as OCR'd minus
    ["500-", -50000n], // trailing minus (bank statements)
    ["1,234.56-", -123456n],
    ["( 500 )", -50000n],
    ["-0", 0n],
    ["(0.00)", 0n],
  ])("%s → %d¢", (raw, want) => expectCents(raw, want));

  it("rejects doubled sign markers", () => {
    expectReject("-(500)", "conflicting_signs");
    expectReject("(500)-", "conflicting_signs");
    expectReject("-500-", "conflicting_signs");
  });
});

describe("EU and space-separated formats", () => {
  it.each<[string, bigint]>([
    ["1.020,64", 102064n], // the blueprint's example
    ["1.234.567,89", 123456789n],
    ["10 000", 1000000n],
    ["10 000", 1000000n], // NBSP separator
    ["1 234 567", 123456700n],
    ["1'000", 100000n], // Swiss apostrophe
    ["1'234'567", 123456700n],
    ["10,50", 1050n], // decimal comma, 2dp
    ["10,5", 1050n], // decimal comma, 1dp
    ["€1.020,64", 102064n],
  ])("%s → %d¢", (raw, want) => expectCents(raw, want));

  it("single comma + 3 digits is US grouping, not EU decimal", () => {
    expectCents("1,020", 102000n);
    expectCents("999,000", 99900000n);
  });

  it("single dot + 3 digits is AMBIGUOUS → review (never guess)", () => {
    expectReject("1.020", "ambiguous_separator");
    expectReject("999.000", "ambiguous_separator");
  });
});

describe("dot-only edge shapes", () => {
  it("4+ integer digits with 3 decimals cannot be grouping → too many decimals", () => {
    // "1234.567" can't be EU grouping (groups are 1-3 leading digits) —
    // it's a 3-decimal number, which cents cannot represent: reject.
    expectReject("1234.567", "too_many_decimals");
    expectReject("1.2345", "too_many_decimals");
  });

  it("multiple dots are EU grouping only when shaped exactly right", () => {
    expectCents("1.234.567", 123456700n);
    expectReject("1.23.456", "malformed_grouping");
    expectReject("12.3456.78", "malformed_grouping");
  });
});

describe("null vs zero disambiguation (Blueprint §4.4)", () => {
  it.each<[string, string]>([
    ["", "empty"],
    ["   ", "empty"],
    ["-", "dash"],
    ["—", "dash"], // em dash
    ["–", "dash"], // en dash
    ["---", "dash"],
    ["N/A", "na"],
    ["n/a", "na"],
    ["NA", "na"],
    ["none", "na"],
  ])("'%s' → null (%s)", (raw, why) => expectNull(raw, why));

  it("zero is a VALUE, never null", () => {
    expectCents("0", 0n);
    expectCents("0.00", 0n);
    expectCents("(0)", 0n);
  });
});

describe("IRS cents boxes", () => {
  it("main + cents box combine", () => {
    expectCents("1,234", 123456n, { centsBox: "56" });
    expectCents("1,234", 123400n, { centsBox: "00" });
    expectCents("1,234", 123400n, { centsBox: "" });
    expectCents("1,234", 123400n, { centsBox: "—" });
    expectCents("1,234", 123405n, { centsBox: "5".padStart(1, "0") }); // "5" → 05
  });

  it("cents box + inline decimals is a contradiction → reject", () => {
    expectReject("1,234.56", "invalid_cents_box", { centsBox: "78" });
  });

  it("garbage cents box rejects", () => {
    expectReject("1,234", "invalid_cents_box", { centsBox: "5x" });
    expectReject("1,234", "invalid_cents_box", { centsBox: "123" });
  });
});

describe('"in thousands" scaling (statement-level, M5.3 detects)', () => {
  it.each<[string, bigint, 1 | 1000 | 1000000]>([
    ["1,234", 123400000n, 1000], // $1,234k = $1,234,000.00
    ["1,234.5", 123450000n, 1000],
    ["(500)", -50000000n, 1000],
    ["2.5", 250000000n, 1000000], // $2.5M
    ["1,234", 123400n, 1],
  ])("%s @ scale %d", (raw, want, scale) => expectCents(raw, want, { scale }));
});

describe("garbage and V1-trap inputs", () => {
  it.each<[string, string]>([
    ["abc", "not_a_number"],
    ["12abc34", "not_a_number"],
    ["$", "not_a_number"],
    ["1,23,456", "malformed_grouping"], // broken US grouping
    ["1,2345", "malformed_grouping"],
    [",", "not_a_number"],
    ["1..5", "malformed_grouping"],
    ["1,,5", "malformed_grouping"],
  ])("'%s' rejects (%s)", (raw, reason) => expectReject(raw, reason));

  it("NEVER welds two space-separated values (post-mortem trap 6)", () => {
    // "1,200 3,400" is two column values that geometric parsing should have
    // separated. The normalizer must refuse — not produce 12003400.
    const r = normalizeAmount("1,200 3,400");
    expect(r.ok).toBe(false);
  });

  it("handles values beyond Number.MAX_SAFE_INTEGER exactly", () => {
    expectCents("90,071,992,547,409.93", 9007199254740993n);
  });

  it("classic float traps are exact", () => {
    expectCents("0.1", 10n);
    expectCents("0.2", 20n);
    // 0.1 + 0.2 in cents: 10n + 20n === 30n — no 0.30000000000000004.
    expectCents("0.3", 30n);
  });
});
