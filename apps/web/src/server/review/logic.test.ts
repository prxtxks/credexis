import { describe, expect, it } from "vitest";
import {
  buildSupersession,
  orderQueue,
  summarizeProgress,
  type QueueFact,
  type SupersedableFact,
} from "./logic";

const qf = (id: string, p: Partial<QueueFact> = {}): QueueFact => ({
  id,
  logicalDocumentId: "doc-a",
  sourcePage: 1,
  createdAt: "2026-07-16T10:00:00Z",
  ...p,
});

describe("orderQueue (M6.3) — severity first, then document order", () => {
  it("critical issues jump the queue; unimplicated facts go last", () => {
    const ordered = orderQueue(
      [qf("plain"), qf("tampered"), qf("broken-sum")],
      [
        { severity: "critical", factIds: ["tampered"] }, // G5 fraud signal
        { severity: "error", factIds: ["broken-sum"] }, // G1
      ],
    );
    expect(ordered.map((o) => o.id)).toEqual(["tampered", "broken-sum", "plain"]);
    expect(ordered[0]?.topSeverity).toBe("critical");
    expect(ordered[2]?.topSeverity).toBeNull();
  });

  it("a fact keeps its HIGHEST severity across multiple issues", () => {
    const ordered = orderQueue(
      [qf("x"), qf("y")],
      [
        { severity: "info", factIds: ["x"] },
        { severity: "error", factIds: ["x"] },
        { severity: "warning", factIds: ["y"] },
      ],
    );
    expect(ordered[0]).toMatchObject({ id: "x", topSeverity: "error" });
  });

  it("ties break by document, then page, then creation time", () => {
    const ordered = orderQueue(
      [
        qf("late", { logicalDocumentId: "doc-b", sourcePage: 9 }),
        qf("p3", { sourcePage: 3 }),
        qf("p1", { sourcePage: 1, createdAt: "2026-07-16T10:00:01Z" }),
        qf("p1-first", { sourcePage: 1 }),
      ],
      [],
    );
    expect(ordered.map((o) => o.id)).toEqual(["p1-first", "p1", "p3", "late"]);
  });
});

describe("buildSupersession (Iron Law #5) — corrections never mutate", () => {
  const oldFact: SupersedableFact = {
    id: "old-1",
    tenant_id: "t1",
    deal_id: "d1",
    entity_id: "e1",
    period_id: "p1",
    taxonomy_node_key: "is.opex.rent",
    registry_field_id: "f1120s.line11",
    value_cents: "3600000",
    status: "suggested",
    source_logical_document_id: "ld1",
    source_page: 2,
    source_bbox: { x: 0.6, y: 0.4, w: 0.2, h: 0.02 },
  };

  it("copies identity + lineage, sets override semantics, preserves the original value", () => {
    const plan = buildSupersession(oldFact, "3650000", "user-9", "typo on doc");
    expect(plan.insert).toMatchObject({
      tenant_id: "t1",
      deal_id: "d1",
      entity_id: "e1",
      period_id: "p1",
      taxonomy_node_key: "is.opex.rent",
      registry_field_id: "f1120s.line11",
      value_cents: "3650000",
      original_value_cents: "3600000", // the audit display of what it was
      method: "override",
      status: "accepted",
      confidence: 1,
      created_by: "user-9",
      source_page: 2, // lineage travels with the correction
    });
    expect(plan.patch).toEqual({ status: "overridden" });
  });

  it("refuses to correct anything that is not in review", () => {
    expect(() => buildSupersession({ ...oldFact, status: "accepted" }, "1", "u")).toThrow(
      /only suggested/,
    );
    expect(() => buildSupersession({ ...oldFact, status: "overridden" }, "1", "u")).toThrow(
      /only suggested/,
    );
  });

  it("refuses non-integer money (floats never touch a fact)", () => {
    expect(() => buildSupersession(oldFact, "36500.50", "u")).toThrow(/integer cents/);
    expect(() => buildSupersession(oldFact, "36,500", "u")).toThrow(/integer cents/);
    expect(() => buildSupersession(oldFact, "", "u")).toThrow(/integer cents/);
  });

  it("handles negative corrections (losses) exactly", () => {
    const plan = buildSupersession(oldFact, "-123400", "u");
    expect(plan.insert["value_cents"]).toBe("-123400");
  });
});

describe("summarizeProgress", () => {
  it('renders the "N of M fields need review" bar', () => {
    const p = summarizeProgress({ suggested: 14, accepted: 6, overridden: 1, rejected: 1 });
    expect(p).toMatchObject({ total: 22, remaining: 14, done: 8 });
    expect(p.label).toBe("14 of 22 fields need review");
  });

  it("zero facts → zero everything, no NaN", () => {
    const p = summarizeProgress({ suggested: 0, accepted: 0, overridden: 0, rejected: 0 });
    expect(p).toMatchObject({ total: 0, remaining: 0, done: 0 });
  });
});
