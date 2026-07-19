import { describe, expect, it } from "vitest";
import { transcriptFactRows } from "./logic";

const CTX = {
  tenantId: "t-1",
  dealId: "d-1",
  entityId: "e-1",
  periodId: "p-1",
  taxonomyByRegistryField: { "f1120s.line21": "is.net_income" },
};

describe("transcriptFactRows", () => {
  it("maps lines to authoritative transcript facts with registry lineage", () => {
    const rows = transcriptFactRows(
      [
        { registryFieldId: "f1120s.line21", valueCents: "12000000" },
        { registryFieldId: "f1120s.line1a", valueCents: "-50000" },
      ],
      CTX,
    );
    expect(rows[0]).toMatchObject({
      registry_field_id: "f1120s.line21",
      taxonomy_node_key: "is.net_income", // mapped through the registry
      value_cents: "12000000",
      method: "transcript",
      status: "accepted",
      confidence: 1,
      source_transcript_line: "f1120s.line21",
    });
    // Unknown registry field → fact still lands (G5 keys on registry id),
    // taxonomy placement stays null for the mapper to learn later.
    expect(rows[1]!.taxonomy_node_key).toBeNull();
  });

  it("refuses non-integer money", () => {
    expect(() => transcriptFactRows([{ registryFieldId: "x", valueCents: "120.50" }], CTX)).toThrow(
      /integer cents/,
    );
  });
});
