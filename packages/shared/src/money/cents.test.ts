import { describe, expect, it } from "vitest";
import {
  absCents,
  addCents,
  cents,
  compareCents,
  divRoundHalfEven,
  eqCents,
  formatCentsUSD,
  gtCents,
  gteCents,
  ltCents,
  lteCents,
  mulCentsByInt,
  mulCentsByRatio,
  negateCents,
  subCents,
  sumCents,
  ZERO_CENTS,
} from "./cents.js";

describe("the float-failure class this module exists to prevent", () => {
  it("shows why money is never a JS number", () => {
    // The canonical IEEE-754 failure.
    expect(0.1 + 0.2).not.toBe(0.3);
    // Represented as integer cents it is exact, forever.
    expect(addCents(cents(10n), cents(20n))).toBe(30n);
    expect(formatCentsUSD(addCents(cents(10n), cents(20n)))).toBe("$0.30");
  });
});

describe("cents / ZERO_CENTS", () => {
  it("wraps a bigint and exposes zero", () => {
    expect(cents(1234n)).toBe(1234n);
    expect(ZERO_CENTS).toBe(0n);
  });
});

describe("addition, subtraction, negation, absolute value", () => {
  it("adds and subtracts exactly", () => {
    expect(addCents(cents(199n), cents(1n))).toBe(200n);
    expect(subCents(cents(200n), cents(201n))).toBe(-1n);
  });

  it("negates", () => {
    expect(negateCents(cents(500n))).toBe(-500n);
    expect(negateCents(cents(-500n))).toBe(500n);
  });

  it("takes absolute value on both sign branches", () => {
    expect(absCents(cents(-500n))).toBe(500n);
    expect(absCents(cents(500n))).toBe(500n);
  });
});

describe("integer and rational scaling", () => {
  it("multiplies by an integer count exactly", () => {
    expect(mulCentsByInt(cents(12345n), 12n)).toBe(148140n);
  });

  it("scales by a ratio with banker's rounding (10% equity injection)", () => {
    // 10% of $123.45 = $12.345 → rounds to the even neighbour $12.34.
    expect(mulCentsByRatio(cents(12345n), 10n, 100n)).toBe(1234n);
  });
});

describe("sumCents", () => {
  it("returns zero for an empty list", () => {
    expect(sumCents([])).toBe(0n);
  });

  it("sums a list", () => {
    expect(sumCents([cents(100n), cents(250n), cents(-50n)])).toBe(300n);
  });
});

describe("comparisons", () => {
  it("compareCents covers less / equal / greater", () => {
    expect(compareCents(cents(1n), cents(2n))).toBe(-1);
    expect(compareCents(cents(2n), cents(2n))).toBe(0);
    expect(compareCents(cents(3n), cents(2n))).toBe(1);
  });

  it("boolean comparators return both outcomes", () => {
    expect(eqCents(cents(1n), cents(1n))).toBe(true);
    expect(eqCents(cents(1n), cents(2n))).toBe(false);
    expect(ltCents(cents(1n), cents(2n))).toBe(true);
    expect(ltCents(cents(2n), cents(1n))).toBe(false);
    expect(lteCents(cents(2n), cents(2n))).toBe(true);
    expect(lteCents(cents(3n), cents(2n))).toBe(false);
    expect(gtCents(cents(3n), cents(2n))).toBe(true);
    expect(gtCents(cents(1n), cents(2n))).toBe(false);
    expect(gteCents(cents(2n), cents(2n))).toBe(true);
    expect(gteCents(cents(1n), cents(2n))).toBe(false);
  });
});

describe("divRoundHalfEven — the single rounding primitive", () => {
  it("returns exact quotients (zero remainder)", () => {
    expect(divRoundHalfEven(8n, 4n)).toBe(2n);
  });

  it("rounds down when below half", () => {
    expect(divRoundHalfEven(5n, 4n)).toBe(1n);
  });

  it("rounds up when above half", () => {
    expect(divRoundHalfEven(7n, 4n)).toBe(2n);
  });

  it("rounds half to the even neighbour (up when quotient is odd)", () => {
    expect(divRoundHalfEven(3n, 2n)).toBe(2n); // 1.5 → 2
  });

  it("rounds half to the even neighbour (stays when quotient is even)", () => {
    expect(divRoundHalfEven(5n, 2n)).toBe(2n); // 2.5 → 2
    expect(divRoundHalfEven(1n, 2n)).toBe(0n); // 0.5 → 0
  });

  it("handles every sign combination", () => {
    expect(divRoundHalfEven(-7n, 4n)).toBe(-2n);
    expect(divRoundHalfEven(7n, -4n)).toBe(-2n);
    expect(divRoundHalfEven(-7n, -4n)).toBe(2n);
  });

  it("throws on divide-by-zero", () => {
    expect(() => divRoundHalfEven(1n, 0n)).toThrow(RangeError);
  });
});

describe("formatCentsUSD", () => {
  it("formats zero and sub-dollar amounts with padded cents", () => {
    expect(formatCentsUSD(ZERO_CENTS)).toBe("$0.00");
    expect(formatCentsUSD(cents(5n))).toBe("$0.05");
  });

  it("groups thousands", () => {
    expect(formatCentsUSD(cents(100n))).toBe("$1.00");
    expect(formatCentsUSD(cents(123456789n))).toBe("$1,234,567.89");
  });

  it("formats negatives with a leading minus", () => {
    expect(formatCentsUSD(cents(-150000n))).toBe("-$1,500.00");
  });
});
