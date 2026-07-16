/**
 * @credexis/engine — the ONE calc engine (Iron Law #3).
 *
 * Pure TypeScript: zero I/O, zero React, zero LLM. Input is
 * (facts, addbacks, scenario, policyPack); output is a versioned metric set
 * computed in integer cents. The client renders these — it never computes them.
 * The metric DAG lands in M7; this entrypoint is a placeholder until then.
 */

export const ENGINE_PACKAGE = "@credexis/engine" as const;

export * from "./gates/types.js";
export * from "./gates/gates.js";
export * from "./confidence/scorer.js";
