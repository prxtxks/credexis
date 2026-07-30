/**
 * Signal-sweep corpus manifest (corpus-1): PUBLIC IRS documents used to
 * adversarially exercise the deterministic split signals - never counted
 * in accuracy claims (Iron Law #9; these are not customer bundles).
 *
 * Two kinds:
 * - "official-form": the IRS's own PDF of one form (current + prior-year
 *   revisions). Every page either classifies as that family or abstains;
 *   a CONFIDENT hit on a different family is a sweep failure.
 * - "ats-bundle": the IRS's Modernized e-File Assurance Testing System
 *   scenarios - complete FILLED returns the IRS publishes for e-file
 *   software certification. Realistic multi-form bundles with zero PII.
 *   Confident hits outside `allowedFamilies` are flagged for review
 *   (report, not hard failure - bundles legitimately contain forms we
 *   do not support yet, which should abstain).
 *
 * PDFs download to corpus/signal-sweep/ (gitignored - public and
 * re-downloadable); only this manifest and the findings are tracked.
 */

import type { FormFamily } from "@credexis/schema";

export type SweepKind = "official-form" | "ats-bundle";

export interface SweepDoc {
  /** Stable id; also the local filename stem. */
  id: string;
  url: string;
  kind: SweepKind;
  /** official-form: the single family every classified page must match. */
  family?: FormFamily;
  /** ats-bundle: families that may legitimately appear in the bundle. */
  allowedFamilies?: readonly FormFamily[];
  note?: string;
}

const PRIOR = "https://www.irs.gov/pub/irs-prior";
const CURRENT = "https://www.irs.gov/pub/irs-pdf";

/** Official form PDFs: base filename → family, with the revision years the
 *  IRS actually serves (probed 2026-07-30; 1125-E and 8825 are rarely
 *  revised and only exist as current). */
const OFFICIAL_FORMS: ReadonlyArray<{
  base: string;
  family: FormFamily;
  years: readonly number[];
}> = [
  { base: "f1120s", family: "1120S", years: [2019, 2021, 2023] },
  { base: "f1120", family: "1120", years: [2019, 2021, 2023] },
  { base: "f1065", family: "1065", years: [2019, 2021, 2023] },
  { base: "f1040", family: "1040", years: [2019, 2021, 2023] },
  { base: "f1040sc", family: "1040_SCH_C", years: [2019, 2021, 2023] },
  { base: "f1040se", family: "1040_SCH_E", years: [2019, 2021, 2023] },
  { base: "f1040sf", family: "1040_SCH_F", years: [2019, 2021, 2023] },
  { base: "f1040s1", family: "1040_SCH_1", years: [2019, 2021, 2023] },
  { base: "f4562", family: "4562", years: [2019, 2021, 2023] },
  { base: "f1125e", family: "1125E", years: [] },
  { base: "f8825", family: "8825", years: [] },
  { base: "fw2", family: "W2", years: [2019, 2021, 2023] },
  { base: "f1120ssk", family: "K1_1120S", years: [2019, 2021, 2023] },
  { base: "f1065sk1", family: "K1_1065", years: [2019, 2021, 2023] },
];

const CORP_1120: readonly FormFamily[] = ["1120", "1125E", "4562"];
// "1120" is allowed in S-corp bundles: Schedule N is titled "(Form 1120)"
// by the IRS itself and files with 1120-S returns (sweep finding).
const CORP_1120S: readonly FormFamily[] = ["1120S", "K1_1120S", "1125E", "4562", "8825", "1120"];
const PARTNERSHIP: readonly FormFamily[] = ["1065", "K1_1065", "4562", "8825"];

/** TY2023 MeF ATS scenario PDFs (URLs from the IRS ATS information pages). */
const ATS_BUNDLES: ReadonlyArray<SweepDoc> = [
  ...[
    ["ats-1120-s1", "1120-test-scenario-1-ty23.pdf"],
    ["ats-1120-s1-alt", "1120-test-scenario-1-alternate-ty23.pdf"],
    ["ats-1120-s2", "1120-ats-test-scenario-2-ty23.pdf"],
    ["ats-1120-s3", "1120-ats-test-scenario-3-ty23.pdf"],
    ["ats-1120-s4", "1120-ats-test-scenario-4-ty23.pdf"],
  ].map(
    ([id, file]): SweepDoc => ({
      id: id!,
      url: `https://www.irs.gov/pub/irs-schema/${file}`,
      kind: "ats-bundle",
      allowedFamilies: CORP_1120,
    }),
  ),
  ...[
    ["ats-1120s-s5", "1120s-ats-test-scenario-5-ty23.pdf"],
    ["ats-1120s-s6", "1120s-ats-test-scenario-6-ty23.pdf"],
    ["ats-1120s-s7", "1120s-ats-test-scenario-7-ty23.pdf"],
    ["ats-1120s-s8", "1120s-ats-test-scenario-8-ty23.pdf"],
    ["ats-1120s-s10", "1120s-ats-test-scenario-10-ty23.pdf"],
  ].map(
    ([id, file]): SweepDoc => ({
      id: id!,
      url: `https://www.irs.gov/pub/irs-schema/${file}`,
      kind: "ats-bundle",
      allowedFamilies: CORP_1120S,
    }),
  ),
  {
    id: "ats-1120f-s9",
    url: "https://www.irs.gov/pub/irs-schema/1120f-ats-test-scenario-9-ty23.pdf",
    kind: "ats-bundle",
    allowedFamilies: ["1120", "1125E"],
    note:
      "1120-F is an UNSUPPORTED family - its own pages must abstain (a confident hit is a " +
      "boundary bug). The bundle legitimately contains a real Form 1125-E and Schedule UTP " +
      "(Form 1120), which the IRS titles as 1120-family.",
  },
  {
    id: "ats-1120-s11",
    url: "https://www.irs.gov/pub/irs-efile/1120%20MeF%20ATS%20scenario%2011.pdf",
    kind: "ats-bundle",
    allowedFamilies: CORP_1120,
  },
  {
    id: "ats-1120-s12",
    url: "https://www.irs.gov/pub/irs-efile/1120-mef-ats-scenario-12-ty23.pdf",
    kind: "ats-bundle",
    allowedFamilies: CORP_1120,
  },
  ...[
    ["ats-1065-s1", "1065-ats-scenario01-ty23.pdf"],
    ["ats-1065-s2", "1065-ats-scenario02-ty23.pdf"],
    ["ats-1065-s3", "1065-ats-scenario03-ty23v2.pdf"],
    ["ats-1065-s4", "1065-ats-scenario04-ty2023v2.pdf"],
    ["ats-1065-sA", "1065-ats-k1aggregator-scenario-a-ty23.pdf"],
    ["ats-1065-sB", "1065-ats-k1aggregator-scenarioB-ty23v2.pdf"],
  ].map(
    ([id, file]): SweepDoc => ({
      id: id!,
      url: `https://www.irs.gov/pub/irs-wi/${file}`,
      kind: "ats-bundle",
      allowedFamilies: PARTNERSHIP,
    }),
  ),
];

export const SWEEP_MANIFEST: readonly SweepDoc[] = [
  ...OFFICIAL_FORMS.flatMap((f) => [
    ...f.years.map(
      (y): SweepDoc => ({
        id: `${f.base}-${y}`,
        url: `${PRIOR}/${f.base}--${y}.pdf`,
        kind: "official-form",
        family: f.family,
      }),
    ),
    {
      id: `${f.base}-current`,
      url: `${CURRENT}/${f.base}.pdf`,
      kind: "official-form" as const,
      family: f.family,
    },
  ]),
  ...ATS_BUNDLES,
];
