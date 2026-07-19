import { describe, expect, it } from "vitest";
import { assembleSpread, normalizeLabel, type SpreadFactRow, type TaxonomyNodeRow } from "./logic";

const NODES: TaxonomyNodeRow[] = [
  { key: "is", parentKey: null, label: "Income Statement", sortOrder: 0, isAddbackRelevant: false },
  { key: "is.revenue", parentKey: "is", label: "Revenue", sortOrder: 1, isAddbackRelevant: false },
  {
    key: "is.revenue.product_sales",
    parentKey: "is.revenue",
    label: "Product sales",
    sortOrder: 2,
    isAddbackRelevant: false,
  },
  {
    key: "is.opex.officer_comp",
    parentKey: "is.opex",
    label: "Officer compensation",
    sortOrder: 3,
    isAddbackRelevant: true,
  },
];

let seq = 0;
const fact = (over: Partial<SpreadFactRow>): SpreadFactRow => ({
  id: `f-${++seq}`,
  taxonomyNodeKey: "is.revenue.product_sales",
  periodLabel: "FY2023",
  valueCents: "1000",
  method: "consensus",
  status: "accepted",
  confidence: 0.9,
  sourcePage: 3,
  sourceLogicalDocumentId: "ld-1",
  ...over,
});

describe("assembleSpread", () => {
  it("pivots facts into node rows × sorted period columns with depth/children info", () => {
    const { periods, rows } = assembleSpread(NODES, [
      fact({ periodLabel: "FY2023", valueCents: "500" }),
      fact({ periodLabel: "FY2022", valueCents: "400" }),
    ]);
    expect(periods).toEqual(["FY2022", "FY2023"]);
    const sales = rows.find((r) => r.key === "is.revenue.product_sales")!;
    expect(sales.depth).toBe(2);
    expect(sales.hasChildren).toBe(false);
    expect(sales.cells["FY2022"]!.valueCents).toBe("400");
    expect(sales.cells["FY2023"]!.valueCents).toBe("500");
    const revenue = rows.find((r) => r.key === "is.revenue")!;
    expect(revenue.hasChildren).toBe(true);
    expect(revenue.cells).toEqual({});
  });

  it("accepted beats suggested; higher authority wins within a status", () => {
    const { rows } = assembleSpread(NODES, [
      fact({ id: "sugg", status: "suggested", valueCents: "111" }),
      fact({ id: "cons", status: "accepted", method: "consensus", valueCents: "222" }),
      fact({ id: "over", status: "accepted", method: "override", valueCents: "333" }),
    ]);
    const cell = rows.find((r) => r.key === "is.revenue.product_sales")!.cells["FY2023"]!;
    expect(cell.factId).toBe("over");
    expect(cell.valueCents).toBe("333");
  });

  it("suggested shows (as pending) only when nothing is accepted; rejected never shows", () => {
    const { rows } = assembleSpread(NODES, [
      fact({ id: "sugg", status: "suggested", valueCents: "111" }),
      fact({ id: "rej", status: "rejected", valueCents: "999" }),
    ]);
    const cell = rows.find((r) => r.key === "is.revenue.product_sales")!.cells["FY2023"]!;
    expect(cell).toMatchObject({ factId: "sugg", status: "suggested" });
  });

  it("flags addback-relevant rows for the inspector", () => {
    const { rows } = assembleSpread(NODES, []);
    expect(rows.find((r) => r.key === "is.opex.officer_comp")!.isAddbackRelevant).toBe(true);
  });
});

describe("normalizeLabel", () => {
  it("lowercases and collapses whitespace, matching the mapper", () => {
    expect(normalizeLabel("  Officer   COMP  ")).toBe("officer comp");
  });
});
