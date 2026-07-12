/**
 * Split/classify accuracy scoring (M3.5): compares predicted
 * (form_family, tax_year) against corpus ground truth per document.
 * Reported alongside extraction metrics; real numbers require real corpus
 * docs (M1.3) — synthetic runs are labeled and never counted in accuracy
 * claims (Iron Law #9).
 */

import type { FormFamily } from "@credexis/schema";

export interface ClassificationCase {
  documentId: string;
  expectedFamily: FormFamily;
  expectedTaxYear: number | null;
  predictedFamily: FormFamily | null;
  predictedTaxYear: number | null;
  synthetic: boolean;
}

export interface ClassificationSummary {
  total: number;
  familyCorrect: number;
  familyAccuracy: number;
  yearCorrect: number;
  yearAccuracy: number;
  /** Predicted null — routed to review rather than guessed (good behavior). */
  abstained: number;
  /** Wrong non-null prediction — the dangerous kind. */
  misclassified: string[];
  byFamily: Record<string, { total: number; correct: number }>;
  syntheticOnly: boolean;
}

export function summarizeClassification(
  cases: readonly ClassificationCase[],
): ClassificationSummary {
  const byFamily: Record<string, { total: number; correct: number }> = {};
  let familyCorrect = 0;
  let yearCorrect = 0;
  let abstained = 0;
  const misclassified: string[] = [];

  for (const c of cases) {
    const bucket = (byFamily[c.expectedFamily] ??= { total: 0, correct: 0 });
    bucket.total += 1;
    if (c.predictedFamily === c.expectedFamily) {
      familyCorrect += 1;
      bucket.correct += 1;
    } else if (c.predictedFamily === null) {
      abstained += 1;
    } else {
      misclassified.push(`${c.documentId}: expected ${c.expectedFamily}, got ${c.predictedFamily}`);
    }
    if (c.expectedTaxYear !== null && c.predictedTaxYear === c.expectedTaxYear) yearCorrect += 1;
  }

  const total = cases.length;
  const withYear = cases.filter((c) => c.expectedTaxYear !== null).length;
  return {
    total,
    familyCorrect,
    familyAccuracy: total === 0 ? 0 : familyCorrect / total,
    yearCorrect,
    yearAccuracy: withYear === 0 ? 0 : yearCorrect / withYear,
    abstained,
    misclassified,
    byFamily,
    syntheticOnly: cases.every((c) => c.synthetic),
  };
}
