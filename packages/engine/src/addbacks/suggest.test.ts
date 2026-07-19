import { describe, expect, it } from "vitest";
import { cents, type Cents } from "@credexis/shared";
import type { EngineFact } from "../core/types.js";
import { suggestAddbacks } from "./suggest.js";

const c = (v: number | bigint): Cents => cents(BigInt(v));
let seq = 0;

function fact(
  taxonomyNodeKey: string,
  valueCents: number,
  over: Partial<EngineFact> = {},
): EngineFact {
  return {
    id: `f-${++seq}`,
    entityId: "e-1",
    periodLabel: "FY2023",
    taxonomyNodeKey,
    valueCents: c(valueCents),
    method: "consensus",
    status: "accepted",
    ...over,
  };
}

describe("suggestAddbacks", () => {
  it("maps expense-side facts to their addback categories at face value", () => {
    const suggestions = suggestAddbacks([
      fact("is.opex.depreciation", 2_000_000),
      fact("is.opex.amortization", 1_000_000),
      fact("is.other.interest_expense", 3_000_000),
      fact("is.opex.officer_comp", 8_000_000),
      fact("is.opex.management_fees", 1_200_000),
      fact("is.other.one_time_items", 500_000),
    ]);
    const by = (factId: string) => suggestions.find((s) => s.factId === factId);
    expect(suggestions).toHaveLength(6);
    expect(by("f-1")).toMatchObject({
      category: "depreciation_amortization",
      amountCents: c(2_000_000),
    });
    expect(by("f-2")).toMatchObject({
      category: "depreciation_amortization",
      amountCents: c(1_000_000),
    });
    expect(by("f-3")).toMatchObject({ category: "interest", amountCents: c(3_000_000) });
    expect(by("f-4")).toMatchObject({ category: "officer_comp", amountCents: c(8_000_000) });
    expect(by("f-5")).toMatchObject({ category: "discretionary", amountCents: c(1_200_000) });
    expect(by("f-6")).toMatchObject({ category: "one_time", amountCents: c(500_000) });
  });

  it("negates one-time INCOME (insurance proceeds, PPP/ERC) — it comes OUT of cash flow", () => {
    const suggestions = suggestAddbacks([
      fact("is.other.insurance_proceeds", 4_000_000),
      fact("is.other.ppp_erc_grants", 2_500_000),
    ]);
    expect(suggestions[0]).toMatchObject({ category: "one_time", amountCents: c(-4_000_000) });
    expect(suggestions[1]).toMatchObject({ category: "one_time", amountCents: c(-2_500_000) });
  });

  it("suggests only from accepted facts and skips zero amounts", () => {
    const suggestions = suggestAddbacks([
      fact("is.opex.depreciation", 2_000_000, { status: "suggested" }),
      fact("is.other.interest_expense", 3_000_000, { status: "rejected" }),
      fact("is.opex.officer_comp", 0),
      fact("is.opex.rent", 3_600_000), // rent ADJUSTMENT needs human judgment — no rule
      fact("is.revenue.product_sales", 50_000_000), // not addback-relevant
    ]);
    expect(suggestions).toHaveLength(0);
  });

  it("carries entity, period, and a human-readable rationale on every suggestion", () => {
    const [s] = suggestAddbacks([fact("is.opex.depreciation", 2_000_000)]);
    expect(s).toMatchObject({ entityId: "e-1", periodLabel: "FY2023" });
    expect(s!.rationale).toMatch(/depreciation/i);
  });

  it("picks the highest-authority fact per node — an override replaces the consensus value", () => {
    const suggestions = suggestAddbacks([
      fact("is.opex.depreciation", 2_000_000),
      fact("is.opex.depreciation", 2_400_000, { method: "override" }),
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ amountCents: c(2_400_000) });
  });
});
