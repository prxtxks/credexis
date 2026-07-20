/**
 * M3.5 acceptance: "mixed 60-page synthetic bundle splits correctly."
 *
 * A realistic messy upload: 3 years of 1120-S returns (+4562, K-1s), a
 * duplicate re-upload, a 1040 with schedules, W-2s, statements with
 * signal-less continuation pages, a 1065 for the target company. Synthetic
 * page text, clearly labeled — never counted in accuracy claims (Iron Law #9).
 */

import { describe, expect, it } from "vitest";
import { classifyBundle, type PageClassifier, type PageInput } from "./classify.js";
import { groupIntoLogicalDocuments, inheritBundleYear } from "./group.js";

/* ── synthetic bundle construction ──────────────────────────────────── */

let pageNo = 0;
const pages: PageInput[] = [];
const expected: Array<{
  family: string | null;
  year: number | null;
  start: number;
  end: number;
  dup?: number;
}> = [];

function push(text: string): number {
  pageNo += 1;
  pages.push({ page: pageNo, text });
  return pageNo;
}

function form1120s(year: number, entity: string) {
  const start = push(
    `${entity}\nForm 1120-S U.S. Income Tax Return for an S Corporation\nOMB No. 1545-0123\nFor calendar year ${year}`,
  );
  push(`Form 1120-S (${year}) Page 2\nSchedule B Other Information`);
  push(`Form 1120-S (${year}) Page 3\nSchedule K Shareholders' Pro Rata Share Items`);
  push(`Form 1120-S (${year}) Page 4\nSchedule L Balance Sheets per Books`);
  const end = push(`Form 1120-S (${year}) Page 5\nSchedule M-1 Reconciliation`);
  expected.push({ family: "1120S", year, start, end });
}

function form4562(year: number, marker: string): [number, number] {
  const start = push(
    `Form 4562 Depreciation and Amortization\nOMB No. 1545-0172\ntax year ${year}\n${marker}`,
  );
  const end = push(`Form 4562 (${year}) Page 2\nListed Property\n${marker}`);
  expected.push({ family: "4562", year, start, end });
  return [start, end];
}

function k1_1120s(year: number, shareholder: string) {
  const p = push(
    `Schedule K-1 (Form 1120-S)\nOMB No. 1545-0123\ntax year ${year}\nShareholder: ${shareholder}`,
  );
  expected.push({ family: "K1_1120S", year, start: p, end: p });
}

// 3 years of business returns
form1120s(2023, "ACME HOLDINGS LLC");
form4562(2023, "asset schedule A"); // pages 6-7
k1_1120s(2023, "Jane Founder");
k1_1120s(2023, "John Partner");
form1120s(2022, "ACME HOLDINGS LLC");
form4562(2022, "asset schedule A");
k1_1120s(2022, "Jane Founder");
k1_1120s(2022, "John Partner");
form1120s(2021, "ACME HOLDINGS LLC");
form4562(2021, "asset schedule A");
k1_1120s(2021, "Jane Founder");
k1_1120s(2021, "John Partner");

// The broker re-uploaded the 2023 4562 — byte-identical text → duplicate.
{
  const start = push(
    `Form 4562 Depreciation and Amortization\nOMB No. 1545-0172\ntax year 2023\nasset schedule A`,
  );
  const end = push(`Form 4562 (2023) Page 2\nListed Property\nasset schedule A`);
  expected.push({ family: "4562", year: 2023, start, end, dup: 1 }); // dup of span index 1
}

// Guarantor personal returns
{
  const start = push(
    `Form 1040 U.S. Individual Income Tax Return\nOMB No. 1545-0074\ntax year 2023`,
  );
  const end = push(`Form 1040 (2023) Page 2\nTax and Credits`);
  expected.push({ family: "1040", year: 2023, start, end });
}
{
  const p = push(`Schedule 1 (Form 1040)\nAdditional Income\nOMB No. 1545-0074\ntax year 2023`);
  expected.push({ family: "1040_SCH_1", year: 2023, start: p, end: p });
}
{
  const start = push(
    `Schedule C (Form 1040)\nProfit or Loss From Business\nOMB No. 1545-0074\ntax year 2023`,
  );
  const end = push(`Schedule C (Form 1040) 2023 Page 2\nCost of Goods Sold`);
  expected.push({ family: "1040_SCH_C", year: 2023, start, end });
}
{
  const p = push(
    `Schedule E (Form 1040)\nSupplemental Income and Loss\nOMB No. 1545-0074\ntax year 2023`,
  );
  expected.push({ family: "1040_SCH_E", year: 2023, start: p, end: p });
}
for (const employer of ["ACME HOLDINGS LLC", "SIDE GIG INC"]) {
  const p = push(`Form W-2 Wage and Tax Statement\nOMB No. 1545-0008\ntax year 2023\n${employer}`);
  expected.push({ family: "W2", year: 2023, start: p, end: p });
}

// Statements — continuation pages carry NO deterministic signals.
{
  const start = push(`ACME HOLDINGS LLC\nProfit and Loss\nJanuary - December 2024`);
  push(`Utilities 4,200\nRent 36,000\nPayroll 412,000`); // unresolved → attaches
  const end = push(`Total Expenses 512,300\nNet Income 88,140`); // unresolved → attaches
  expected.push({ family: "PNL", year: null, start, end });
}
{
  const start = push(`ACME HOLDINGS LLC\nBalance Sheet\nAs of December 31, 2024`);
  const end = push(`Total liabilities and equity 1,204,500`); // unresolved → attaches
  expected.push({ family: "BALANCE_SHEET", year: null, start, end });
}
{
  const p = push(`ACME HOLDINGS LLC\nBusiness Debt Schedule\nas of 12/31/2024`);
  expected.push({ family: "DEBT_SCHEDULE", year: null, start: p, end: p });
}

// More IRS attachments
{
  const p = push(`Form 1125-E Compensation of Officers\nOMB No. 1545-0123\ntax year 2023`);
  expected.push({ family: "1125E", year: 2023, start: p, end: p });
}
{
  const start = push(
    `Form 8825 Rental Real Estate Income and Expenses of a Partnership\nOMB No. 1545-0123\ntax year 2023`,
  );
  const end = push(`Form 8825 (2023) Page 2\nProperty C`);
  expected.push({ family: "8825", year: 2023, start, end });
}

// Target company: 1065 + partner K-1s
{
  const start = push(
    `TARGET VENTURES LP\nForm 1065 U.S. Return of Partnership Income\nOMB No. 1545-0123\ntax year 2023`,
  );
  push(`Form 1065 (2023) Page 2\nSchedule B`);
  push(`Form 1065 (2023) Page 3\nSchedule B continued`);
  push(`Form 1065 (2023) Page 4\nSchedule K`);
  const end = push(`Form 1065 (2023) Page 5\nSchedule L`);
  expected.push({ family: "1065", year: 2023, start, end });
}
for (const partner of ["Alpha Partner", "Beta Partner"]) {
  const p = push(`Schedule K-1 (Form 1065)\nOMB No. 1545-0123\ntax year 2023\nPartner: ${partner}`);
  expected.push({ family: "K1_1065", year: 2023, start: p, end: p });
}

// Prior-year personal return + W-2s + prior-year P&L
{
  const start = push(
    `Form 1040 U.S. Individual Income Tax Return\nOMB No. 1545-0074\ntax year 2022`,
  );
  const end = push(`Form 1040 (2022) Page 2\nTax and Credits`);
  expected.push({ family: "1040", year: 2022, start, end });
}
for (const employer of ["ACME HOLDINGS LLC", "SIDE GIG INC"]) {
  const p = push(`Form W-2 Wage and Tax Statement\nOMB No. 1545-0008\ntax year 2022\n${employer}`);
  expected.push({ family: "W2", year: 2022, start: p, end: p });
}
{
  const start = push(`ACME HOLDINGS LLC\nProfit and Loss\nJanuary - December 2023`);
  push(`Utilities 3,900\nRent 34,000\nPayroll 388,000`);
  const end = push(`Total Expenses 495,100\nNet Income 71,020`);
  expected.push({ family: "PNL", year: null, start, end });
}

/* ── the acceptance test ────────────────────────────────────────────── */

describe("M3.5 acceptance: mixed 60-page synthetic bundle", () => {
  it("is exactly 60 pages (bundle construction sanity)", () => {
    expect(pages).toHaveLength(60);
  });

  it("splits into the expected logical documents — deterministic only, no LLM", async () => {
    const classifications = await classifyBundle(pages, null);
    const spans = await groupIntoLogicalDocuments(pages, classifications);

    expect(spans).toHaveLength(expected.length); // 31 logical documents
    for (let i = 0; i < expected.length; i++) {
      const want = expected[i];
      const got = spans[i];
      expect(got?.formFamily, `span ${i}`).toBe(want?.family);
      expect(got?.pageStart, `span ${i} start`).toBe(want?.start);
      expect(got?.pageEnd, `span ${i} end`).toBe(want?.end);
      if (want?.year) expect(got?.taxYear, `span ${i} year`).toBe(want.year);
    }
  });

  it("flags the re-uploaded 4562 as a duplicate by content hash", async () => {
    const classifications = await classifyBundle(pages, null);
    const spans = await groupIntoLogicalDocuments(pages, classifications);
    const dupIndex = expected.findIndex((e) => e.dup !== undefined);
    expect(spans[dupIndex]?.duplicateOf).toBe(expected[dupIndex]?.dup);
    // All other spans are originals.
    spans.forEach((s, i) => {
      if (i !== dupIndex) expect(s.duplicateOf, `span ${i}`).toBeNull();
    });
  });

  it("extracts entity hints from first pages", async () => {
    const classifications = await classifyBundle(pages, null);
    const spans = await groupIntoLogicalDocuments(pages, classifications);
    expect(spans[0]?.entityHint).toBe("ACME HOLDINGS LLC");
    const t1065 = spans.find((s) => s.formFamily === "1065");
    expect(t1065?.entityHint).toBe("TARGET VENTURES LP");
  });

  it("classification accuracy over the bundle is reportable (per-page)", async () => {
    const classifications = await classifyBundle(pages, null);
    const deterministic = classifications.filter((c) => c.method === "deterministic");
    // 55 of 60 pages carry printed signals; 5 statement continuations don't.
    expect(deterministic.length).toBe(55);
    expect(classifications.filter((c) => c.method === "unresolved")).toHaveLength(5);
  });
});

describe("LLM fallback path (mock classifier)", () => {
  it("only unresolved pages reach the LLM; its answers fill the gaps", async () => {
    const seen: number[] = [];
    const mock: PageClassifier = {
      classifyPages: (ps) => {
        seen.push(...ps.map((p) => p.page));
        return Promise.resolve(
          ps.map((p) => ({
            page: p.page,
            formFamily: "PNL" as const,
            taxYear: null,
            isDocumentStart: false,
            confidence: 0.7,
            method: "llm" as const,
            matched: ["llm"],
          })),
        );
      },
    };
    const classifications = await classifyBundle(pages, mock);
    expect(seen).toHaveLength(5); // exactly the signal-less pages
    expect(classifications.filter((c) => c.method === "llm")).toHaveLength(5);
    expect(classifications.filter((c) => c.method === "unresolved")).toHaveLength(0);
  });
});

describe("inheritBundleYear (2026-07-19 real-document finding)", () => {
  const span = (family, year, start = 1) => ({
    formFamily: family,
    taxYear: year,
    pageStart: start,
    pageEnd: start,
    confidence: 0.9,
    contentSha256: "x",
    duplicateOf: null,
    entityHint: null,
  });

  it("undated tax-form spans inherit the bundle's single year", () => {
    const out = inheritBundleYear([
      span("1120S", null),
      span("K1_1120S", 2023, 7),
      span("4562", 2023, 9),
    ]);
    expect(out[0].taxYear).toBe(2023);
  });

  it("multiple distinct years → no inference", () => {
    const out = inheritBundleYear([
      span("1120S", null),
      span("K1_1120S", 2022, 7),
      span("4562", 2023, 9),
    ]);
    expect(out[0].taxYear).toBeNull();
  });

  it("statements never inherit a tax year", () => {
    const out = inheritBundleYear([span("PNL", null), span("K1_1120S", 2023, 7)]);
    expect(out[0].taxYear).toBeNull();
  });

  it("no dated spans at all → unchanged", () => {
    const out = inheritBundleYear([span("1120S", null)]);
    expect(out[0].taxYear).toBeNull();
  });
});
