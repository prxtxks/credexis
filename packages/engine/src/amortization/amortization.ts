/**
 * Amortization module (M7.2, Blueprint §7): monthly level-payment schedules
 * in integer cents. Internals run on plain-bigint fixed-point mantissas
 * (scale 1e18); `Cents` is unwrapped at entry and re-wrapped at exit, with
 * banker's rounding applied at defined boundaries only (payment, interest).
 *
 * Rates arrive RESOLVED as basis points. `resolveRateBps` combines a rate
 * spec with the current prime rate and an optional policy cap — both are
 * inputs (Iron Law #8: SBA caps are policy DATA; nothing here hardcodes
 * a threshold).
 *
 * Conventions (documented for the golden-Excel cross-check, M7.6):
 * - Stepped/variable rates re-amortize the remaining balance over the
 *   remaining term when a step takes effect (standard SBA treatment).
 * - Interim interest-only months precede amortization; the balance then
 *   amortizes over the remaining months.
 * - The final payment adjusts to retire the balance exactly.
 * - Annual debt service = 12 × the first amortizing payment (underwriting
 *   annualization convention).
 */

import { cents, divRoundHalfEven, type Cents } from "@credexis/shared";

/**
 * Structural mirror of the schema's RateSpec (jsonb on loan_scenarios).
 * The engine cannot import @credexis/schema — that would drag the ORM
 * inside the zero-I/O boundary — so the shape is duplicated here and the
 * schema's type must stay assignable to it.
 */
export interface RateSpecInput {
  type: "fixed" | "prime_spread";
  /** Basis points — integers, never float percentages. */
  bps?: number;
  spread_bps?: number;
}

export interface RateResolutionContext {
  /** Current Wall Street Journal prime rate, bps. Required for prime_spread. */
  primeBps?: number;
  /** Policy-pack rate cap, bps (SOP maximum for the loan size/term). */
  capBps?: number;
}

export function resolveRateBps(spec: RateSpecInput, ctx: RateResolutionContext): number {
  let resolved: number;
  if (spec.type === "fixed") {
    if (spec.bps === undefined) throw new Error("resolveRateBps: fixed rate requires bps");
    resolved = spec.bps;
  } else {
    if (ctx.primeBps === undefined) {
      throw new Error("resolveRateBps: prime_spread requires the current prime rate");
    }
    resolved = ctx.primeBps + (spec.spread_bps ?? 0);
  }
  if (resolved < 0) throw new Error(`resolveRateBps: negative rate (${resolved} bps)`);
  return ctx.capBps !== undefined ? Math.min(resolved, ctx.capBps) : resolved;
}

export interface RateStep {
  /** 1-based month this rate takes effect; the first step must be month 1. */
  fromMonth: number;
  annualRateBps: number;
}

export interface AmortizationInput {
  principalCents: Cents;
  termMonths: number;
  /** Resolved rate steps (see resolveRateBps), ascending by fromMonth. */
  rateSteps: RateStep[];
  /** Interim interest-only months at the start (default 0). */
  interestOnlyMonths?: number;
}

export interface AmortizationRow {
  month: number;
  paymentCents: Cents;
  interestCents: Cents;
  principalCents: Cents;
  /** Balance after this month's payment. */
  balanceCents: Cents;
}

export interface AmortizationResult {
  schedule: AmortizationRow[];
  /** Level payment of the first amortizing segment. */
  monthlyPaymentCents: Cents;
  /** 12 × monthlyPaymentCents — underwriting annualization. */
  annualDebtServiceCents: Cents;
  totalInterestCents: Cents;
}

/* ── fixed-point internals (plain bigint, scale 1e18) ─────────────────── */

// 1e18: at 1e12 the monthly-rate mantissa truncation alone (1 bps / 12 is
// non-terminating) showed up as ~2¢ on a $386k payment — caught by the
// float-oracle property. At 1e18 the relative error is ~1e-18, invisible
// next to the ±0.5¢ boundary rounding.
const ONE = 10n ** 18n;

const mulFp = (a: bigint, b: bigint): bigint => divRoundHalfEven(a * b, ONE);

/** (1 + i)^n by squaring; each step rounds at 1e-18 — error ≪ 1¢ at $5M. */
function powOnePlus(iFp: bigint, n: number): bigint {
  let result = ONE;
  let base = ONE + iFp;
  let e = n;
  while (e > 0) {
    if (e & 1) result = mulFp(result, base);
    base = mulFp(base, base);
    e >>= 1;
  }
  return result;
}

const monthlyRateFp = (annualBps: number): bigint =>
  divRoundHalfEven(BigInt(annualBps) * ONE, 120_000n);

/** Level payment for `balance` cents over `n` months at monthly rate iFp. */
function levelPayment(balance: bigint, iFp: bigint, n: number): bigint {
  if (iFp === 0n) return divRoundHalfEven(balance, BigInt(n));
  const f = powOnePlus(iFp, n);
  return divRoundHalfEven(balance * mulFp(iFp, f), f - ONE);
}

/* ── schedule ─────────────────────────────────────────────────────────── */

function validate(input: AmortizationInput): void {
  if (BigInt(input.principalCents) <= 0n) {
    throw new Error("amortize: principal must be positive");
  }
  if (!Number.isInteger(input.termMonths) || input.termMonths < 1) {
    throw new Error(`amortize: term must be ≥ 1 month (got ${input.termMonths})`);
  }
  if (input.rateSteps.length === 0) throw new Error("amortize: at least one rate step required");
  if (input.rateSteps[0]!.fromMonth !== 1) {
    throw new Error("amortize: the first rate step must start at month 1");
  }
  for (let i = 0; i < input.rateSteps.length; i++) {
    const step = input.rateSteps[i]!;
    if (step.annualRateBps < 0) throw new Error("amortize: negative rate step");
    if (i > 0 && step.fromMonth <= input.rateSteps[i - 1]!.fromMonth) {
      throw new Error("amortize: rate steps must ascend by fromMonth");
    }
  }
  const io = input.interestOnlyMonths ?? 0;
  if (io < 0 || io >= input.termMonths) {
    throw new Error("amortize: interest-only months must leave at least one amortizing month");
  }
}

export function amortize(input: AmortizationInput): AmortizationResult {
  validate(input);
  const { termMonths, rateSteps } = input;
  const interestOnly = input.interestOnlyMonths ?? 0;

  let balance = BigInt(input.principalCents);
  let totalInterest = 0n;
  let payment = 0n;
  let firstAmortizingPayment: bigint | null = null;
  let activeStep = -1;
  const schedule: AmortizationRow[] = [];

  for (let month = 1; month <= termMonths; month++) {
    // Advance to the rate step in effect this month.
    let stepped = false;
    while (activeStep + 1 < rateSteps.length && rateSteps[activeStep + 1]!.fromMonth <= month) {
      activeStep++;
      stepped = true;
    }
    const iFp = monthlyRateFp(rateSteps[activeStep]!.annualRateBps);
    const interest = mulFp(balance, iFp);

    let principalPart: bigint;
    if (month <= interestOnly) {
      // Interim period: service interest, touch no principal.
      payment = interest;
      principalPart = 0n;
    } else {
      const amortizationStarts = month === interestOnly + 1;
      if (stepped || amortizationStarts) {
        // (Re-)amortize the current balance over the remaining term.
        payment = levelPayment(balance, iFp, termMonths - month + 1);
        firstAmortizingPayment ??= payment;
      }
      principalPart = payment - interest;
      if (principalPart < 0n) principalPart = 0n; // rounding guard on tiny principals
      if (month === termMonths || principalPart > balance) {
        principalPart = balance; // final payment retires the balance exactly
      }
    }

    balance -= principalPart;
    totalInterest += interest;
    schedule.push({
      month,
      paymentCents: cents(interest + principalPart),
      interestCents: cents(interest),
      principalCents: cents(principalPart),
      balanceCents: cents(balance),
    });
  }

  const monthly = firstAmortizingPayment ?? 0n;
  return {
    schedule,
    monthlyPaymentCents: cents(monthly),
    annualDebtServiceCents: cents(monthly * 12n),
    totalInterestCents: cents(totalInterest),
  };
}
