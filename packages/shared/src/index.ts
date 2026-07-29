/**
 * @credexis/shared — cross-cutting primitives with zero product logic:
 * money utilities (integer cents / fixed-point decimal, Iron Law #2), the
 * deterministic number normalizer (Blueprint §4.4), and content hashing.
 */

export * from "./hash.js";
export * from "./money/index.js";
export * from "./normalize/number.js";
export * from "./match/name-match.js";
export * from "./email/index.js";
export * from "./limits.js";
