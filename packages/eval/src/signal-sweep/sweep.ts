/**
 * Signal sweep (corpus-1): run the REAL deterministic detector over every
 * page of the sweep corpus and report what it decided.
 *
 * Verdicts per page:
 * - "ok"       classified as an expected family, or abstained (abstention
 *              is the designed fallback - the LLM/review tier's job)
 * - "wrong"    official-form page confidently classified as a DIFFERENT
 *              family - hard failure, the false-confidence class
 * - "suspect"  ats-bundle page confidently classified outside the
 *              scenario's allowed set - review fodder, not a hard failure
 *              (bundles contain forms we do not support, which abstain)
 *
 * The runner exits non-zero if any "wrong" verdict exists, so the sweep
 * can gate CI once the corpus is downloaded in that environment.
 */

import { loadPdf } from "@credexis/corpus-tools";
import { detectPageSignals } from "@credexis/extraction";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { SWEEP_MANIFEST, type SweepDoc } from "./manifest.js";

const CONFIDENT = 0.9;

export interface PageFinding {
  doc: string;
  page: number;
  verdict: "wrong" | "suspect";
  family: string;
  confidence: number;
  matched: string[];
  excerpt: string;
}

export interface SweepReport {
  docs: number;
  pages: number;
  classified: number;
  abstained: number;
  findings: PageFinding[];
  perDoc: Record<string, { pages: number; families: Record<string, number>; abstained: number }>;
}

function verdictFor(doc: SweepDoc, family: string, confidence: number): "ok" | "wrong" | "suspect" {
  if (confidence < CONFIDENT) return "ok";
  if (doc.kind === "official-form") {
    return family === doc.family ? "ok" : "wrong";
  }
  return (doc.allowedFamilies ?? []).includes(family as never) ? "ok" : "suspect";
}

export async function runSweep(dir: string): Promise<SweepReport> {
  const report: SweepReport = {
    docs: 0,
    pages: 0,
    classified: 0,
    abstained: 0,
    findings: [],
    perDoc: {},
  };

  for (const doc of SWEEP_MANIFEST) {
    let pdf;
    try {
      pdf = await loadPdf(join(dir, `${doc.id}.pdf`));
    } catch {
      continue; // not downloaded in this environment - sweep what exists
    }
    report.docs += 1;
    const perDoc = { pages: pdf.pageCount, families: {} as Record<string, number>, abstained: 0 };
    report.perDoc[doc.id] = perDoc;

    pdf.pageTexts.forEach((text, i) => {
      report.pages += 1;
      const s = detectPageSignals(text);
      if (s.formFamily === null) {
        report.abstained += 1;
        perDoc.abstained += 1;
        return;
      }
      report.classified += 1;
      perDoc.families[s.formFamily] = (perDoc.families[s.formFamily] ?? 0) + 1;
      const verdict = verdictFor(doc, s.formFamily, s.confidence);
      if (verdict !== "ok") {
        report.findings.push({
          doc: doc.id,
          page: i + 1,
          verdict,
          family: s.formFamily,
          confidence: s.confidence,
          matched: s.matched,
          excerpt: text.replace(/\s+/g, " ").slice(0, 160),
        });
      }
    });
  }
  return report;
}

export async function writeSweepReport(report: SweepReport, dir: string): Promise<string> {
  const path = join(dir, "sweep-report.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  return path;
}
