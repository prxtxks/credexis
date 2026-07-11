/**
 * Shared adapter-contract assertions (M3.3). Every adapter's tests run
 * these against recorded vendor responses — the invariants ARE the
 * interface; a vendor that can't satisfy them doesn't get merged.
 */

import { expect } from "vitest";
import {
  fieldCandidateSchema,
  layoutPageSchema,
  type FieldExtractionResult,
  type FieldRequest,
  type LayoutParseResult,
} from "../types.js";

export function assertFieldContract(
  result: FieldExtractionResult,
  requested: FieldRequest[],
): void {
  // Exactly one candidate per requested field, in request order.
  expect(result.candidates.map((c) => c.fieldId)).toEqual(requested.map((f) => f.fieldId));

  for (const c of result.candidates) {
    // Schema invariants (bbox in [0,1], confidence 0..1, shapes).
    fieldCandidateSchema.parse(c);
    // Absent value ⇒ no page claim (never fabricate lineage).
    if (c.valueText === null) expect(c.page).toBeNull();
    // Present value ⇒ raw text is non-empty (empty string is a vendor bug).
    if (c.valueText !== null) expect(c.valueText.length).toBeGreaterThan(0);
  }

  assertRunInfo(result);
}

export function assertLayoutContract(result: LayoutParseResult): void {
  expect(result.pages.length).toBeGreaterThan(0);
  for (const p of result.pages) layoutPageSchema.parse(p);
  // Pages sorted, 1-based.
  const nums = result.pages.map((p) => p.page);
  expect(nums).toEqual([...nums].sort((a, b) => a - b));
  expect(nums[0]).toBeGreaterThanOrEqual(1);
  assertRunInfo(result);
}

function assertRunInfo(result: { run: LayoutParseResult["run"] }): void {
  expect(result.run.vendor.length).toBeGreaterThan(0);
  expect(result.run.vendorVersion.length).toBeGreaterThan(0);
  expect(result.run.pageCount).toBeGreaterThanOrEqual(1);
  // Cost tracked, integer micro-USD, non-negative (standing order #9).
  expect(typeof result.run.costMicroUsd).toBe("bigint");
  expect(result.run.costMicroUsd >= 0n).toBe(true);
}
