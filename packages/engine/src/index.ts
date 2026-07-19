/**
 * @credexis/engine — the ONE calc engine (Iron Law #3).
 *
 * Pure TypeScript: zero I/O, zero React, zero LLM. Input is
 * (facts, addbacks, scenario, policyPack); output is a versioned metric set
 * computed in integer cents. The client renders these — it never computes them.
 */

export const ENGINE_PACKAGE = "@credexis/engine" as const;

export * from "./gates/types.js";
export * from "./gates/gates.js";
export * from "./confidence/scorer.js";
export * from "./amortization/amortization.js";
export * from "./core/types.js";
export * from "./core/compute.js";
