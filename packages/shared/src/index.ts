/**
 * @credexis/shared — cross-cutting primitives with zero product logic.
 *
 * Home of the money utilities (integer cents / fixed-point decimal, Iron Law #2)
 * and the deterministic number normalizer (Blueprint §4.4). Those land in M0.6
 * and M3.6 respectively; this entrypoint is intentionally minimal until then.
 */

export const SHARED_PACKAGE = "@credexis/shared" as const;

export * from "./money/index.js";
