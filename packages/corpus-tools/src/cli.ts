#!/usr/bin/env node
/**
 * Corpus intake CLI (M1.2).
 *
 *   corpus template <pdf> --id <corpus-id>   emit YAML skeleton next to the PDF
 *   corpus check <pdf>                       redaction scan (SSN/EIN patterns)
 *   corpus add <filled.yaml> --pdf <pdf>     validate + redaction gate + write
 *       [--corpus-dir corpus] [--confirm-redacted] [--force]
 *
 * `add` refuses to write unless the redaction scan is clean AND the operator
 * confirms visual verification (interactive prompt, or --confirm-redacted in
 * non-interactive use). PDFs are never modified and never committed.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { corpusManifestSchema } from "@credexis/schema";
import { generateSynthetic } from "./generate-synthetic.js";
import {
  groundTruthPath,
  parseFilledTemplate,
  renderYamlTemplate,
  upsertManifestEntry,
} from "./intake.js";
import { loadPdf } from "./pdf.js";
import { scanPii, type PiiFinding } from "./redaction.js";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) fail(`${name} requires a value`);
  return v;
}

function printFindings(findings: PiiFinding[]): void {
  for (const f of findings) {
    console.error(`  [${f.severity}] page ${f.page}: ${f.kind} ${f.masked}`);
  }
}

async function confirmInteractive(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} (yes/no) `)).trim().toLowerCase();
  rl.close();
  return answer === "yes";
}

async function cmdTemplate(args: string[]): Promise<void> {
  const pdfPath = args[0] ?? fail("usage: corpus template <pdf> --id <corpus-id>");
  const id = getFlag(args, "--id") ?? fail("--id is required (e.g. 1120s-2023-native-001)");
  const pdf = await loadPdf(pdfPath);
  const outPath = pdfPath.replace(/\.pdf$/i, "") + ".ground-truth.yaml";
  await writeFile(outPath, renderYamlTemplate(id, basename(pdfPath), pdf), "utf8");
  console.log(`template written: ${outPath}`);
  console.log(`  sha256=${pdf.sha256} pages=${pdf.pageCount}`);
}

async function cmdCheck(args: string[]): Promise<number> {
  const pdfPath = args[0] ?? fail("usage: corpus check <pdf>");
  const pdf = await loadPdf(pdfPath);
  const findings = scanPii(pdf.pageTexts);
  if (findings.length === 0) {
    console.log(`redaction scan clean: ${basename(pdfPath)} (${pdf.pageCount} pages)`);
    return 0;
  }
  console.error(`redaction scan found ${findings.length} PII-shaped string(s):`);
  printFindings(findings);
  return 1;
}

async function cmdAdd(args: string[]): Promise<void> {
  const yamlPath = args[0] ?? fail("usage: corpus add <filled.yaml> --pdf <pdf>");
  const pdfPath = getFlag(args, "--pdf") ?? fail("--pdf is required");
  const corpusDir = getFlag(args, "--corpus-dir") ?? "corpus";
  const force = args.includes("--force");

  // 1. Validate the filled template (zod; throws with field-level errors).
  const { document, json } = parseFilledTemplate(await readFile(yamlPath, "utf8"));

  // 2. Bind label ⇄ exact PDF bytes.
  const pdf = await loadPdf(pdfPath);
  if (pdf.sha256 !== document.pdf_sha256) {
    fail(
      `pdf_sha256 mismatch: YAML says ${document.pdf_sha256}, file is ${pdf.sha256}. ` +
        `Labels bind to exact bytes — regenerate the template for this file.`,
    );
  }
  if (pdf.pageCount !== document.page_count) {
    fail(`page_count mismatch: YAML says ${document.page_count}, file has ${pdf.pageCount}.`);
  }

  // 3. Redaction gate: scan must be clean, then a human confirms visually.
  const findings = scanPii(pdf.pageTexts);
  if (findings.length > 0) {
    console.error("REFUSING to add: PII-shaped strings found. Redact the PDF first.");
    printFindings(findings);
    process.exit(1);
  }
  const confirmed =
    args.includes("--confirm-redacted") ||
    (await confirmInteractive(
      "Scan is clean. Have you VISUALLY confirmed the PDF is redacted (SSNs/EINs masked)?",
    ));
  if (!confirmed) {
    fail("redaction not confirmed (answer yes, or pass --confirm-redacted non-interactively)");
  }

  // 4. Write ground truth + manifest.
  const gtRelPath = groundTruthPath(document.id);
  const gtAbsPath = join(corpusDir, gtRelPath);
  await mkdir(join(corpusDir, "ground-truth"), { recursive: true });
  await writeFile(gtAbsPath, JSON.stringify(json, null, 2) + "\n", "utf8");

  const manifestPath = join(corpusDir, "manifest.json");
  const manifest = corpusManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const updated = upsertManifestEntry(
    manifest,
    {
      id: document.id,
      ground_truth_path: gtRelPath,
      pdf_sha256: pdf.sha256,
      pdf_bytes: pdf.bytes,
      pdf_bucket_key: null,
    },
    { updatedAt: new Date().toISOString(), force },
  );
  await writeFile(manifestPath, JSON.stringify(updated, null, 2) + "\n", "utf8");

  console.log(`added ${document.id}:`);
  console.log(`  ground truth → ${gtAbsPath}`);
  console.log(`  manifest updated (${updated.documents.length} documents)`);
  console.log(`  NOTE: keep the PDF under ${corpusDir}/pdfs/ (gitignored).`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "template":
      return cmdTemplate(rest);
    case "check":
      process.exit(await cmdCheck(rest));
    // eslint-disable-next-line no-fallthrough -- process.exit above never falls through
    case "add":
      return cmdAdd(rest);
    case "generate-synthetic": {
      const dir = getFlag(rest, "--corpus-dir") ?? "corpus";
      const ids = await generateSynthetic(dir);
      console.log(`generated ${ids.length} synthetic fixtures into ${dir}/synthetic/:`);
      for (const id of ids) console.log(`  - ${id}`);
      console.log("(synthetic — NEVER counted in accuracy claims)");
      return;
    }
    default:
      fail(
        "usage: corpus <template|check|add|generate-synthetic> …  (see file header for details)",
      );
  }
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
