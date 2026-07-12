import { describe, expect, it } from "vitest";
import { summarizeClassification, type ClassificationCase } from "./classification.js";

const base = { expectedTaxYear: 2023, predictedTaxYear: 2023, synthetic: true };

describe("classification scoring (M3.5)", () => {
  it("scores family + year accuracy, separating abstentions from misclassifications", () => {
    const cases: ClassificationCase[] = [
      { documentId: "a", expectedFamily: "1120S", predictedFamily: "1120S", ...base },
      { documentId: "b", expectedFamily: "W2", predictedFamily: "W2", ...base },
      // abstained — routed to review, not a lie:
      { documentId: "c", expectedFamily: "PNL", predictedFamily: null, ...base },
      // misclassified — the dangerous kind:
      { documentId: "d", expectedFamily: "1065", predictedFamily: "1120", ...base },
    ];
    const s = summarizeClassification(cases);
    expect(s.total).toBe(4);
    expect(s.familyCorrect).toBe(2);
    expect(s.familyAccuracy).toBeCloseTo(0.5);
    expect(s.abstained).toBe(1);
    expect(s.misclassified).toEqual(["d: expected 1065, got 1120"]);
    expect(s.byFamily["1120S"]).toEqual({ total: 1, correct: 1 });
    expect(s.syntheticOnly).toBe(true); // labeled — never an accuracy claim
  });

  it("year accuracy only counts docs that have a ground-truth year", () => {
    const cases: ClassificationCase[] = [
      {
        documentId: "a",
        expectedFamily: "PNL",
        predictedFamily: "PNL",
        expectedTaxYear: null,
        predictedTaxYear: null,
        synthetic: true,
      },
      {
        documentId: "b",
        expectedFamily: "1040",
        predictedFamily: "1040",
        expectedTaxYear: 2023,
        predictedTaxYear: 2023,
        synthetic: true,
      },
    ];
    const s = summarizeClassification(cases);
    expect(s.yearAccuracy).toBe(1);
  });

  it("mixed real docs clear the syntheticOnly flag", () => {
    const s = summarizeClassification([
      { documentId: "a", expectedFamily: "W2", predictedFamily: "W2", ...base, synthetic: false },
    ]);
    expect(s.syntheticOnly).toBe(false);
  });

  it("empty input yields zeroes, not NaN", () => {
    const s = summarizeClassification([]);
    expect(s.familyAccuracy).toBe(0);
    expect(s.yearAccuracy).toBe(0);
  });
});
