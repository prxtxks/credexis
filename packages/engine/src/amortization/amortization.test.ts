import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cents, type Cents } from "@credexis/shared";
import { amortize, resolveRateBps, type AmortizationInput } from "./amortization.js";

const c = (v: number | bigint): Cents => cents(BigInt(v));

/**
 * Independent float cross-check (the "finance library" oracle): the standard
 * annuity formula computed in IEEE-754. The engine's bigint fixed-point
 * result must land within 2¢ of it — close enough to prove the math, loose
 * enough that float noise never flakes the suite. Golden Excel deals (M7.6,
 * [PRATIK]) later pin exact expectations.
 */
function floatLevelPayment(principalCents: number, annualBps: number, n: number): number {
  const i = annualBps / 10000 / 12;
  if (i === 0) return principalCents / n;
  const f = Math.pow(1 + i, n);
  return (principalCents * i * f) / (f - 1);
}

describe("resolveRateBps", () => {
  it("passes a fixed rate through", () => {
    expect(resolveRateBps({ type: "fixed", bps: 1050 }, {})).toBe(1050);
  });

  it("adds spread to prime for variable rates", () => {
    expect(resolveRateBps({ type: "prime_spread", spread_bps: 275 }, { primeBps: 750 })).toBe(1025);
  });

  it("applies the policy cap when the sum exceeds it (cap is DATA, never code)", () => {
    expect(
      resolveRateBps({ type: "prime_spread", spread_bps: 600 }, { primeBps: 750, capBps: 1050 }),
    ).toBe(1050);
  });

  it("refuses prime_spread without a prime rate input", () => {
    expect(() => resolveRateBps({ type: "prime_spread", spread_bps: 275 }, {})).toThrow(/prime/);
  });

  it("refuses fixed without bps", () => {
    expect(() => resolveRateBps({ type: "fixed" }, {})).toThrow(/bps/);
  });
});

describe("amortize — canonical fixtures", () => {
  it("reproduces the textbook $100,000 @ 12%, 12 months schedule", () => {
    // Classic amortization example: level payment $8,884.88.
    const result = amortize({
      principalCents: c(10_000_000),
      termMonths: 12,
      rateSteps: [{ fromMonth: 1, annualRateBps: 1200 }],
    });
    expect(result.monthlyPaymentCents).toBe(c(888_488));
    expect(result.schedule).toHaveLength(12);
    // Month 1: interest = $100,000 × 1% = $1,000.00.
    expect(result.schedule[0]!.interestCents).toBe(c(100_000));
    expect(result.schedule[0]!.principalCents).toBe(c(788_488));
    // The loan pays off exactly.
    expect(result.schedule[11]!.balanceCents).toBe(0n);
  });

  it("reproduces the textbook $100,000 @ 6%, 360 months payment ($599.55)", () => {
    const result = amortize({
      principalCents: c(10_000_000),
      termMonths: 360,
      rateSteps: [{ fromMonth: 1, annualRateBps: 600 }],
    });
    expect(result.monthlyPaymentCents).toBe(c(59_955));
    expect(result.schedule[359]!.balanceCents).toBe(0n);
  });

  it("handles a zero-rate loan as straight principal division", () => {
    const result = amortize({
      principalCents: c(120_000),
      termMonths: 12,
      rateSteps: [{ fromMonth: 1, annualRateBps: 0 }],
    });
    expect(result.monthlyPaymentCents).toBe(c(10_000));
    expect(result.totalInterestCents).toBe(0n);
    expect(result.schedule[11]!.balanceCents).toBe(0n);
  });

  it("annual debt service = 12 × the amortizing payment", () => {
    const result = amortize({
      principalCents: c(35_000_000), // $350k — SBA small-loan boundary
      termMonths: 120,
      rateSteps: [{ fromMonth: 1, annualRateBps: 1025 }], // prime 7.50% + 2.75%
    });
    expect(result.annualDebtServiceCents).toBe(c(BigInt(result.monthlyPaymentCents) * 12n));
  });
});

describe("amortize — structures", () => {
  it("interest-only interim months precede amortization (SBA interim structures)", () => {
    const result = amortize({
      principalCents: c(10_000_000),
      termMonths: 15,
      rateSteps: [{ fromMonth: 1, annualRateBps: 1200 }],
      interestOnlyMonths: 3,
    });
    // Months 1–3: interest only ($1,000.00), balance unchanged.
    for (const m of result.schedule.slice(0, 3)) {
      expect(m.paymentCents).toBe(c(100_000));
      expect(m.principalCents).toBe(0n);
      expect(m.balanceCents).toBe(c(10_000_000));
    }
    // Months 4–15 amortize the full balance over the remaining 12 months —
    // identical to the textbook 12-month schedule.
    expect(result.monthlyPaymentCents).toBe(c(888_488));
    expect(result.schedule[14]!.balanceCents).toBe(0n);
  });

  it("re-amortizes the remaining balance when a stepped rate kicks in", () => {
    const stepped = amortize({
      principalCents: c(10_000_000),
      termMonths: 24,
      rateSteps: [
        { fromMonth: 1, annualRateBps: 900 },
        { fromMonth: 13, annualRateBps: 1200 },
      ],
    });
    const flat = amortize({
      principalCents: c(10_000_000),
      termMonths: 24,
      rateSteps: [{ fromMonth: 1, annualRateBps: 900 }],
    });
    // Same payment while the first rate holds…
    expect(stepped.schedule[0]!.paymentCents).toBe(flat.schedule[0]!.paymentCents);
    // …then a HIGHER payment after the step (same balance, higher rate).
    expect(BigInt(stepped.schedule[12]!.paymentCents)).toBeGreaterThan(
      BigInt(flat.schedule[12]!.paymentCents),
    );
    // Month-13 payment re-amortizes month-12's ending balance over 12 months
    // at the new rate — exactly the textbook formula on that balance.
    const expected = Math.round(
      floatLevelPayment(Number(stepped.schedule[11]!.balanceCents), 1200, 12),
    );
    expect(Number(stepped.schedule[12]!.paymentCents)).toBeCloseTo(expected, -1);
    expect(stepped.schedule[23]!.balanceCents).toBe(0n);
  });

  it("rejects invalid inputs loudly", () => {
    const base: AmortizationInput = {
      principalCents: c(100),
      termMonths: 12,
      rateSteps: [{ fromMonth: 1, annualRateBps: 100 }],
    };
    expect(() => amortize({ ...base, principalCents: c(0) })).toThrow(/principal/);
    expect(() => amortize({ ...base, termMonths: 0 })).toThrow(/term/);
    expect(() => amortize({ ...base, rateSteps: [] })).toThrow(/rate/);
    expect(() => amortize({ ...base, rateSteps: [{ fromMonth: 2, annualRateBps: 100 }] })).toThrow(
      /month 1/,
    );
    expect(() => amortize({ ...base, interestOnlyMonths: 12 })).toThrow(/interest-only/);
  });
});

describe("amortize — properties", () => {
  const inputArb = fc.record({
    principal: fc.bigInt({ min: 100_00n, max: 500_000_000_00n }), // $100 … $5M (7(a) max)
    termMonths: fc.integer({ min: 1, max: 300 }), // …25y (SBA RE max)
    annualRateBps: fc.integer({ min: 0, max: 2000 }), // 0…20%
  });

  it("conserves money: Σ principal = loan; interest + principal = payment, every month", () => {
    fc.assert(
      fc.property(inputArb, ({ principal, termMonths, annualRateBps }) => {
        const r = amortize({
          principalCents: cents(principal),
          termMonths,
          rateSteps: [{ fromMonth: 1, annualRateBps }],
        });
        let paidPrincipal = 0n;
        let prevBalance = principal;
        for (const m of r.schedule) {
          expect(BigInt(m.interestCents) + BigInt(m.principalCents)).toBe(BigInt(m.paymentCents));
          expect(BigInt(m.balanceCents)).toBe(prevBalance - BigInt(m.principalCents));
          expect(BigInt(m.balanceCents)).toBeGreaterThanOrEqual(0n);
          paidPrincipal += BigInt(m.principalCents);
          prevBalance = BigInt(m.balanceCents);
        }
        expect(paidPrincipal).toBe(principal);
        expect(r.schedule.at(-1)!.balanceCents).toBe(0n);
      }),
      { numRuns: 200 },
    );
  });

  it("matches the independent float annuity formula within 2¢", () => {
    fc.assert(
      fc.property(inputArb, ({ principal, termMonths, annualRateBps }) => {
        const r = amortize({
          principalCents: cents(principal),
          termMonths,
          rateSteps: [{ fromMonth: 1, annualRateBps }],
        });
        const oracle = floatLevelPayment(Number(principal), annualRateBps, termMonths);
        expect(Math.abs(Number(r.monthlyPaymentCents) - oracle)).toBeLessThanOrEqual(2);
      }),
      { numRuns: 200 },
    );
  });
});
