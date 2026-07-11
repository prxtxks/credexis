/**
 * Compile-time proof that `0.1 + 0.2` class bugs are impossible (M0.6).
 *
 * This file is never executed and never emitted — it is checked by
 * `tsconfig.typetest.json`. Each `@ts-expect-error` line asserts that the code
 * below it MUST fail to type-check; if any of these ever start compiling, the
 * typecheck fails and the guarantee is broken.
 */

import { addCents, cents, type Cents } from "./index.js";

const a: Cents = cents(10n);
const b: Cents = cents(20n);

// @ts-expect-error a float number cannot be assigned to Cents (money is bigint)
const bad1: Cents = 0.3;

// @ts-expect-error cannot mix a Cents (bigint) with a number in arithmetic
const bad2 = a + 0.1;

// @ts-expect-error cannot mix a number with Cents (bigint) in arithmetic
const bad3 = 0.1 + b;

// @ts-expect-error Number(...) produces a number, not Cents
const bad4: Cents = Number("5");

// The sanctioned path always type-checks.
const ok: Cents = addCents(a, b);

// Reference the bindings so they are not flagged as unused.
export const _typetestRefs = [bad1, bad2, bad3, bad4, ok];
