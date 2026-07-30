import { describe, expect, it } from "vitest";
import { selectOrphans, SWEEP_BATCH_CAP, SWEEP_GRACE_MS } from "./orphan-sweep.js";

const NOW = new Date("2026-07-30T12:00:00Z");
const doc = (id: string, status: string, ageMs: number) => ({
  id,
  tenantId: "t1",
  dealId: "d1",
  status,
  createdAt: new Date(NOW.getTime() - ageMs).toISOString(),
});

describe("selectOrphans (M13.3 - borrower uploads rescued into the pipeline)", () => {
  it("picks only stale 'uploaded' documents", () => {
    const rows = [
      doc("fresh", "uploaded", 30_000), // inside grace - the web route may still enqueue
      doc("orphan", "uploaded", SWEEP_GRACE_MS + 1_000),
      doc("in-flight", "processing", 3_600_000),
      doc("done", "processed", 3_600_000),
      doc("dead", "failed", 3_600_000),
    ];
    expect(selectOrphans(rows, NOW).map((r) => r.id)).toEqual(["orphan"]);
  });

  it("drains oldest-first under the batch cap", () => {
    const rows = Array.from({ length: SWEEP_BATCH_CAP + 5 }, (_, i) =>
      doc(`d${i}`, "uploaded", SWEEP_GRACE_MS + (i + 1) * 1_000),
    );
    const picked = selectOrphans(rows, NOW);
    expect(picked).toHaveLength(SWEEP_BATCH_CAP);
    // Oldest (largest age) first.
    expect(picked[0]!.id).toBe(`d${SWEEP_BATCH_CAP + 4}`);
  });

  it("returns nothing when everything is healthy", () => {
    expect(selectOrphans([doc("a", "processed", 10_000)], NOW)).toEqual([]);
  });
});
