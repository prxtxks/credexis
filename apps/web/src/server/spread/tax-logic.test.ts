/**
 * Tax Spread assembly (M8.3 tax tab, ADR-0002 follow-up): registry-keyed
 * pivot - including registry-only facts (derived lines with no taxonomy
 * placement, e.g. 1040 AGI), which the statement spread can never show.
 */

import { describe, expect, it } from "vitest";
import { assembleTaxSpread, type RegistryRowMeta, type TaxFactRow } from "./tax-logic";

const META: RegistryRowMeta[] = [
  {
    fieldId: "f1120s.line1c",
    formFamily: "1120S",
    lineNumber: "1c",
    label: "Net receipts",
    taxonomyNodeKey: "is.revenue.total",
  },
  {
    fieldId: "f1040.line9",
    formFamily: "1040",
    lineNumber: "9",
    label: "Total income",
    taxonomyNodeKey: "pcf.income.total",
  },
  {
    fieldId: "f1040.line11",
    formFamily: "1040",
    lineNumber: "11",
    label: "Adjusted gross income",
    taxonomyNodeKey: null, // derived line - registry-only
  },
];

let seq = 0;
function fact(
  p: Partial<TaxFactRow> & Pick<TaxFactRow, "registryFieldId" | "valueCents">,
): TaxFactRow {
  seq += 1;
  return {
    id: p.id ?? `fact-${seq}`,
    registryFieldId: p.registryFieldId,
    taxonomyNodeKey: p.taxonomyNodeKey ?? null,
    periodLabel: p.periodLabel ?? "FY2023",
    valueCents: p.valueCents,
    method: p.method ?? "consensus",
    status: p.status ?? "accepted",
    confidence: p.confidence ?? 0.97,
    sourcePage: p.sourcePage ?? 1,
    sourceLogicalDocumentId: p.sourceLogicalDocumentId ?? "ld-1",
  };
}

describe("assembleTaxSpread", () => {
  it("pivots facts into form-grouped registry rows × sorted period columns", () => {
    const { periods, rows } = assembleTaxSpread(META, [
      fact({ registryFieldId: "f1040.line9", valueCents: "10000000", periodLabel: "FY2024" }),
      fact({ registryFieldId: "f1040.line9", valueCents: "9000000", periodLabel: "FY2023" }),
      fact({ registryFieldId: "f1040.line11", valueCents: "9500000", periodLabel: "FY2024" }),
    ]);

    expect(periods).toEqual(["FY2023", "FY2024"]);
    // One form header for 1040 (1120S has no facts → absent entirely),
    // then its populated lines in registry order.
    expect(rows.map((r) => `${r.kind}:${r.key}`)).toEqual([
      "form:1040",
      "line:f1040.line9",
      "line:f1040.line11",
    ]);
    const line9 = rows.find((r) => r.key === "f1040.line9")!;
    expect(line9.lineNumber).toBe("9");
    expect(line9.cells["FY2023"]!.valueCents).toBe("9000000");
    expect(line9.cells["FY2024"]!.valueCents).toBe("10000000");
  });

  it("marks derived lines without taxonomy placement as registryOnly", () => {
    const { rows } = assembleTaxSpread(META, [
      fact({ registryFieldId: "f1040.line9", valueCents: "10000000" }),
      fact({ registryFieldId: "f1040.line11", valueCents: "9500000" }),
    ]);
    expect(rows.find((r) => r.key === "f1040.line11")!.registryOnly).toBe(true);
    expect(rows.find((r) => r.key === "f1040.line9")!.registryOnly).toBe(false);
  });

  it("selects the best fact per cell: accepted beats suggested, authority breaks ties", () => {
    const { rows } = assembleTaxSpread(META, [
      fact({ registryFieldId: "f1040.line9", valueCents: "1", status: "suggested" }),
      fact({
        id: "winner",
        registryFieldId: "f1040.line9",
        valueCents: "2",
        status: "accepted",
        method: "consensus",
      }),
      fact({
        registryFieldId: "f1040.line11",
        valueCents: "3",
        status: "accepted",
        method: "consensus",
      }),
      fact({
        id: "override-wins",
        registryFieldId: "f1040.line11",
        valueCents: "4",
        status: "accepted",
        method: "override",
      }),
    ]);
    expect(rows.find((r) => r.key === "f1040.line9")!.cells["FY2023"]!.factId).toBe("winner");
    expect(rows.find((r) => r.key === "f1040.line11")!.cells["FY2023"]!.factId).toBe(
      "override-wins",
    );
  });

  it("never renders rejected facts; ignores fields the registry does not know", () => {
    const { rows } = assembleTaxSpread(META, [
      fact({ registryFieldId: "f1040.line9", valueCents: "1", status: "rejected" }),
      fact({ registryFieldId: "f9999.line1", valueCents: "2" }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("flags a cell verified by IRS transcript only when parsed AND transcript agree", () => {
    const { rows } = assembleTaxSpread(META, [
      // AGI: transcript agrees with the parsed value → verified.
      fact({ registryFieldId: "f1040.line11", valueCents: "9500000", method: "consensus" }),
      fact({ registryFieldId: "f1040.line11", valueCents: "9500000", method: "transcript" }),
      // Total income: transcript alone → NOT verified (nothing to corroborate).
      fact({ registryFieldId: "f1040.line9", valueCents: "10000000", method: "transcript" }),
    ]);
    const agi = rows.find((r) => r.key === "f1040.line11")!.cells["FY2023"]!;
    expect(agi.verifiedByTranscript).toBe(true);
    const total = rows.find((r) => r.key === "f1040.line9")!.cells["FY2023"]!;
    expect(total.verifiedByTranscript).toBe(false);
  });
});
