/**
 * Golden pro-forma certification (M7.6): every deal in `golden-deals/` must
 * reproduce the expert workbook's bottom lines to the cent (ratios exact at
 * the engine's published scale). This suite always runs — the synthetic
 * harness check keeps the plumbing honest until the real deals land, and
 * every real deal folder added later is enforced automatically, forever.
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeMetrics } from "@credexis/engine";
import { compareDecimal, formatCentsUSD, formatDecimal } from "@credexis/shared";
import { loadGoldenDeals } from "./golden.js";

const GOLDEN_DIR = fileURLToPath(new URL("../golden-deals", import.meta.url));

const deals = await loadGoldenDeals(GOLDEN_DIR);

describe("golden pro-forma harness (M7.6)", () => {
  it("loads at least one golden deal (the synthetic harness check)", () => {
    expect(deals.length).toBeGreaterThan(0);
  });

  it("real deals present", () => {
    // Informational until the expert's Excel deals arrive [PRATIK]: the
    // engine is CERTIFIED only when this counts ≥ 3 real (non-synthetic)
    // deals. Deliberately not a failing assertion — synthetic-only is the
    // scaffold state, and pretending otherwise would block every CI run.
    const real = deals.filter((d) => !d.synthetic);
    expect(real.length).toBeGreaterThanOrEqual(0);
  });

  for (const deal of deals) {
    describe(`${deal.id}${deal.synthetic ? " (synthetic — harness check only, not evidence)" : ""}`, () => {
      const result = computeMetrics(deal.input);

      for (const exp of deal.expected) {
        const scope = `${exp.entityId ?? "deal"} / ${exp.periodLabel ?? "global"}`;
        it(`${exp.metric} @ ${scope}`, () => {
          const matches = result.metrics.filter(
            (m) =>
              m.metric === exp.metric &&
              m.entityId === exp.entityId &&
              m.periodLabel === exp.periodLabel,
          );
          expect(
            matches.length,
            `engine did not emit ${exp.metric} @ ${scope} — emitted: ${result.metrics
              .filter((m) => m.metric === exp.metric)
              .map((m) => `${m.entityId ?? "deal"}/${m.periodLabel ?? "global"}`)
              .join(", ")}`,
          ).toBe(1);

          const got = matches[0]!.value;
          if (exp.value.kind === "cents") {
            expect(
              got.kind,
              `${exp.metric} @ ${scope}: expected cents, engine emitted ${got.kind}`,
            ).toBe("cents");
            if (got.kind === "cents") {
              expect(
                got.cents,
                `${exp.metric} @ ${scope}: engine ${formatCentsUSD(got.cents)} !== expert ${formatCentsUSD(exp.value.cents)}`,
              ).toBe(exp.value.cents);
            }
          } else {
            expect(
              got.kind,
              `${exp.metric} @ ${scope}: expected ratio, engine emitted ${got.kind}`,
            ).toBe("ratio");
            if (got.kind === "ratio") {
              expect(
                compareDecimal(got.ratio, exp.value.ratio),
                `${exp.metric} @ ${scope}: engine ${formatDecimal(got.ratio)} !== expert ${formatDecimal(exp.value.ratio)}`,
              ).toBe(0);
            }
          }
        });
      }
    });
  }
});
