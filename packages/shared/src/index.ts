/**
 * @credexis/shared — cross-cutting primitives with zero product logic:
 * money utilities (integer cents / fixed-point decimal, Iron Law #2), the
 * deterministic number normalizer (Blueprint §4.4), and content hashing.
 */

export const SHARED_PACKAGE = "@credexis/shared" as const;

export * from "./hash.js";
export * from "./money/index.js";
export * from "./normalize/number.js";
