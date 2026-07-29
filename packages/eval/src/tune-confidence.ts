/**
 * M6.2 — confidence-threshold tuning (the ROC run the scorer's header
 * demands). Mirrors the production tax path exactly (runExtractionPath →
 * reconcile — the same modules extract-stage calls), captures every
 * reconciled field's raw signals over the REAL tax corpus, grades each
 * against ground truth, then sweeps `autoAcceptMin` and reports the
 * precision/coverage curve. The threshold that ships must hold
 * auto-accept precision ≥ 99.5% (Blueprint §4.6); with today's corpus
 * (~120 tax fields) that statistically means ZERO wrong auto-accepts —
 * the tuned value is provisional until the corpus grows (M1.3).
 *
 * Live vendor calls (Reducto + Claude vision, batch mode): run manually,
 * never in CI.
 *
 *   pnpm --filter @credexis/eval run build && \
 *   node packages/eval/dist/tune-confidence.js
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  AnthropicVisionAdapter,
  ReductoAdapter,
  getRegistryEntry,
  reconcile,
  runExtractionPath,
} from "@credexis/extraction";
import { scoreField } from "@credexis/engine";
import type { FormFamily } from "@credexis/schema";
import { slicePdfPages } from "@credexis/pipeline";
import { loadCorpus } from "./corpus.js";

interface SignalRow {
  docId: string;
  fieldId: string;
  path1Cents: string | null;
  path2Cents: string | null;
  path1Confidence: number;
  path2Confidence: number;
  gateBlocked: boolean;
  chosenCents: string | null;
  gtCents: string | null; // null = field not in ground truth (spurious if chosen)
  correct: boolean;
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname ?? ".", "../../..");
  const corpus = await loadCorpus(join(root, "corpus"));

  const reductoKey = process.env["REDUCTO_API_KEY"];
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];
  if (!reductoKey || !anthropicKey) throw new Error("REDUCTO_API_KEY + ANTHROPIC_API_KEY required");
  const reducto = new ReductoAdapter({ apiKey: reductoKey });
  const vision = new AnthropicVisionAdapter({
    apiKey: anthropicKey,
    batch: process.env["EVAL_NO_BATCH"] === "1" ? null : {},
  });

  // Tax docs only: the scorer governs the dual-path tax route; statement
  // facts are always `suggested` by design.
  const taxDocs = corpus.filter(
    (d) => !d.groundTruth.synthetic && d.groundTruth.fields.some((f) => f.registry_field_id),
  );
  console.log(`tuning over ${taxDocs.length} real tax docs`);

  const rows: SignalRow[] = [];
  let gtFieldTotal = 0;

  for (const doc of taxDocs) {
    const gt = doc.groundTruth;
    if (!doc.pdfPath) continue;
    const entry = getRegistryEntry(gt.form_family as FormFamily, gt.tax_year ?? 0);
    if (!entry) {
      console.log(`  ${gt.id}: no registry entry — skipped`);
      continue;
    }
    const pages = gt.fields.map((f) => f.page);
    const bytes = new Uint8Array(await readFile(doc.pdfPath));
    const slice = await slicePdfPages(bytes, Math.min(...pages), Math.max(...pages));
    const input = { bytes: slice.bytes, mimeType: "application/pdf" as const };

    const [p1, p2] = await Promise.all([
      runExtractionPath("path1_vendor", reducto, input, entry),
      runExtractionPath("path2_llm", vision, input, entry),
    ]);
    const rec = reconcile(p1.candidates, p2.candidates, entry);

    const gtByField = new Map(
      gt.fields
        .filter((f) => f.registry_field_id)
        .map((f) => [f.registry_field_id as string, BigInt(f.value_cents ?? "0")]),
    );
    gtFieldTotal += gtByField.size;

    for (const f of rec.fields) {
      if (f.path1 === null && f.path2 === null) continue;
      const chosen = f.valueCents ?? f.path1?.cents ?? f.path2?.cents ?? null;
      const gtVal = gtByField.get(f.fieldId);
      rows.push({
        docId: gt.id,
        fieldId: f.fieldId,
        path1Cents: f.path1?.cents?.toString() ?? null,
        path2Cents: f.path2?.cents?.toString() ?? null,
        path1Confidence: f.path1?.confidence ?? 0,
        path2Confidence: f.path2?.confidence ?? 0,
        gateBlocked: f.implicatedByRelation,
        chosenCents: chosen?.toString() ?? null,
        gtCents: gtVal?.toString() ?? null,
        correct: gtVal !== undefined && chosen !== null && chosen === gtVal,
      });
    }
    console.log(`  ${gt.id}: ${rec.fields.filter((f) => f.path1 || f.path2).length} signal rows`);
  }

  // ── Threshold sweep: decisions recomputed through the REAL scorer ──
  const sweep: {
    autoAcceptMin: number;
    autoAccepted: number;
    autoCorrect: number;
    precision: number | null;
    coverage: number;
    wrong: string[];
  }[] = [];
  for (let t = 30; t <= 95; t += 5) {
    const T = t / 100;
    let auto = 0;
    let autoCorrect = 0;
    const wrong: string[] = [];
    for (const r of rows) {
      const scored = scoreField(
        {
          factId: r.fieldId,
          path1Cents: r.path1Cents === null ? null : BigInt(r.path1Cents),
          path2Cents: r.path2Cents === null ? null : BigInt(r.path2Cents),
          path1Confidence: r.path1Confidence,
          path2Confidence: r.path2Confidence,
          gateBlocked: r.gateBlocked,
        },
        { autoAcceptMin: T, rejectBelow: 0.3 },
      );
      if (scored.decision !== "auto_accept" || scored.agreedAbsent) continue;
      auto += 1;
      if (r.correct) autoCorrect += 1;
      else wrong.push(`${r.docId}:${r.fieldId}`);
    }
    sweep.push({
      autoAcceptMin: T,
      autoAccepted: auto,
      autoCorrect,
      precision: auto === 0 ? null : autoCorrect / auto,
      coverage: gtFieldTotal === 0 ? 0 : autoCorrect / gtFieldTotal,
      wrong,
    });
  }

  const outDir = join(root, "eval-output");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "confidence-tuning.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), gtFieldTotal, rows, sweep }, null, 2),
  );

  console.log(`\nsignals: ${rows.length} rows over ${gtFieldTotal} GT tax fields`);
  console.log("T     auto  correct  precision  coverage  wrong");
  for (const s of sweep) {
    console.log(
      `${s.autoAcceptMin.toFixed(2)}  ${String(s.autoAccepted).padStart(4)}  ${String(
        s.autoCorrect,
      ).padStart(
        7,
      )}  ${s.precision === null ? "     —  " : (s.precision * 100).toFixed(2) + "%"}  ${(
        s.coverage * 100
      ).toFixed(1)}%     ${s.wrong.length === 0 ? "-" : s.wrong.join(", ")}`,
    );
  }
  console.log(`\nreport → eval-output/confidence-tuning.json`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
