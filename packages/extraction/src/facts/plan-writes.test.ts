/**
 * M4.5 "test this hard": idempotent re-runs supersede prior suggested
 * facts, never touch accepted/overridden ones.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Cents } from "@credexis/shared";
import { getRegistryEntry } from "../registry/loader.js";
import { reconcile } from "../consensus/reconcile.js";
import { planFactWrites, type ExistingFact } from "./plan-writes.js";
import type { FieldCandidate } from "../types.js";

const entry = getRegistryEntry("1120S", 2023)!;

/** Clean consensus run: both paths read the same three values. */
function candidates(values: Record<string, string>): FieldCandidate[] {
  return entry.fields.map((f) => ({
    fieldId: f.fieldId,
    valueText: values[f.fieldId] ?? null,
    centsBoxText: values[f.fieldId] ? "00" : null,
    page: values[f.fieldId] ? 1 : null,
    bbox: values[f.fieldId] ? { x: 0.6, y: 0.4, w: 0.2, h: 0.02 } : null,
    confidence: 0.97,
  }));
}

const RUN_A = {
  "f1120s.line7": "185,000",
  "f1120s.line11": "36,000",
  "f1120s.line21": "200,000",
};
const cs = candidates(RUN_A);
const reconciledA = reconcile(cs, cs, entry);

const existingFact = (over: Partial<ExistingFact>): ExistingFact => ({
  id: "fact-1",
  taxonomyNodeKey: "is.opex.officer_comp",
  registryFieldId: "f1120s.line7",
  valueCents: 18500000n as Cents,
  status: "suggested",
  supersededBy: null,
  ...over,
});

describe("fact write planner (M4.5)", () => {
  it("first run: consensus fields with taxonomy homes become inserts with lineage", () => {
    const plan = planFactWrites(reconciledA, entry, []);
    expect(plan.inserts).toHaveLength(3);
    expect(plan.supersedes).toEqual([null, null, null]);
    const officer = plan.inserts.find((i) => i.registryFieldId === "f1120s.line7")!;
    expect(officer).toMatchObject({
      taxonomyNodeKey: "is.opex.officer_comp",
      valueCents: 18500000n,
      method: "consensus",
      sourcePage: 1,
    });
    expect(officer.sourceBbox).not.toBeNull(); // Iron Law #5: lineage required
  });

  it("IDEMPOTENT: re-running the same consensus over its own facts is a no-op", () => {
    const afterFirstRun: ExistingFact[] = [
      existingFact({ id: "f7", registryFieldId: "f1120s.line7", valueCents: 18500000n as Cents }),
      existingFact({
        id: "f11",
        registryFieldId: "f1120s.line11",
        taxonomyNodeKey: "is.opex.rent",
        valueCents: 3600000n as Cents,
      }),
      existingFact({
        id: "f21",
        registryFieldId: "f1120s.line21",
        taxonomyNodeKey: "is.net_income",
        valueCents: 20000000n as Cents,
      }),
    ];
    const plan = planFactWrites(reconciledA, entry, afterFirstRun);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.supersedes).toHaveLength(0);
  });

  it("changed value SUPERSEDES the prior suggested fact — never mutates it", () => {
    const prior = [existingFact({ id: "old-7", valueCents: 17000000n as Cents })];
    const plan = planFactWrites(reconciledA, entry, prior);
    const idx = plan.inserts.findIndex((i) => i.registryFieldId === "f1120s.line7");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(plan.supersedes[idx]).toBe("old-7"); // marked superseded, not deleted
    expect(plan.inserts[idx]?.valueCents).toBe(18500000n);
  });

  it("NEVER touches accepted facts — even when re-extraction disagrees", () => {
    const prior = [
      existingFact({ id: "human-7", status: "accepted", valueCents: 999999900n as Cents }),
    ];
    const plan = planFactWrites(reconciledA, entry, prior);
    expect(plan.inserts.map((i) => i.registryFieldId)).not.toContain("f1120s.line7");
    expect(plan.supersedes).not.toContain("human-7");
    expect(plan.humanDecidedFieldIds).toContain("f1120s.line7");
  });

  it("NEVER touches overridden facts", () => {
    const prior = [existingFact({ id: "human-7", status: "overridden", valueCents: 1n as Cents })];
    const plan = planFactWrites(reconciledA, entry, prior);
    expect(plan.supersedes).not.toContain("human-7");
    expect(plan.humanDecidedFieldIds).toContain("f1120s.line7");
  });

  it("already-superseded facts don't block new writes (only live ones count)", () => {
    const prior = [
      existingFact({ id: "ancient-7", valueCents: 1n as Cents, supersededBy: "old-7" }),
      existingFact({ id: "old-7", valueCents: 18500000n as Cents }),
    ];
    const plan = planFactWrites(reconciledA, entry, prior);
    // live suggested fact matches → idempotent no-op for line7
    expect(plan.inserts.map((i) => i.registryFieldId)).not.toContain("f1120s.line7");
  });

  it("review-lane outcomes produce NO facts, only review routing", () => {
    const disagree = candidates({ ...RUN_A, "f1120s.line8": "100,000" });
    const other = candidates({ ...RUN_A, "f1120s.line8": "150,000" });
    const r = reconcile(disagree, other, entry);
    const plan = planFactWrites(r, entry, []);
    expect(plan.inserts.map((i) => i.registryFieldId)).not.toContain("f1120s.line8");
    expect(plan.reviewFieldIds).toContain("f1120s.line8");
  });

  it("rejected facts do not count as human decisions — re-extraction may write", () => {
    const prior = [
      existingFact({ id: "rej-7", status: "rejected", valueCents: 18500000n as Cents }),
    ];
    const plan = planFactWrites(reconciledA, entry, prior);
    // a rejected fact is dead; the new consensus still lands (as a new fact)
    expect(plan.inserts.map((i) => i.registryFieldId)).toContain("f1120s.line7");
    expect(plan.supersedes).not.toContain("rej-7");
  });

  it("PROPERTY: no plan ever inserts or supersedes over a human-decided field", () => {
    const statusArb = fc.constantFrom<ExistingFact["status"]>(
      "suggested",
      "accepted",
      "overridden",
      "rejected",
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            fieldIdx: fc.nat({ max: entry.fields.length - 1 }),
            status: statusArb,
            cents: fc.bigInt({ min: -10_000_000n, max: 10_000_000n }),
          }),
          { maxLength: 8 },
        ),
        (rows) => {
          const seen = new Set<string>();
          const existing: ExistingFact[] = [];
          rows.forEach((r, i) => {
            const field = entry.fields[r.fieldIdx]!;
            if (seen.has(field.fieldId)) return; // one live fact per field
            seen.add(field.fieldId);
            existing.push(
              existingFact({
                id: `x-${i}`,
                registryFieldId: field.fieldId,
                taxonomyNodeKey: field.taxonomyNodeKey ?? "is.opex.misc",
                status: r.status,
                valueCents: r.cents as Cents,
              }),
            );
          });
          const plan = planFactWrites(reconciledA, entry, existing);
          const humanFields = new Set(
            existing
              .filter((f) => f.status === "accepted" || f.status === "overridden")
              .map((f) => f.registryFieldId),
          );
          const humanIds = new Set(
            existing
              .filter((f) => f.status === "accepted" || f.status === "overridden")
              .map((f) => f.id),
          );
          for (const ins of plan.inserts) {
            expect(humanFields.has(ins.registryFieldId)).toBe(false);
          }
          for (const s of plan.supersedes) {
            if (s !== null) expect(humanIds.has(s)).toBe(false);
          }
        },
      ),
    );
  });
});
