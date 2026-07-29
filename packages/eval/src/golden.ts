/**
 * Golden pro-forma harness loader (M7.6 scaffold) — the engine's constitution.
 *
 * Each folder under `golden-deals/` is one complete deal: the expert's
 * original workbook (`proforma.xlsx`, kept for audit) plus a canonical
 * `deal.json` holding the engine inputs and the workbook's bottom-line
 * answers. The harness test replays every deal through `computeMetrics`
 * and requires cent-exact (and ratio-exact) agreement — forever.
 *
 * Honesty rules (Iron Law #9):
 * - Folders named `_synthetic-*` MUST set `"synthetic": true` and exist
 *   only to prove the harness plumbing works. They are never evidence of
 *   engine correctness and never counted in any accuracy claim.
 * - Real deals (expert-built Excel) must NOT use the `_synthetic-` prefix.
 * - Money is integer-cent strings in JSON (bigint-safe); no floats, ever.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cents, makeDecimal, type Cents } from "@credexis/shared";
import type {
  AddbackCategory,
  EngineAddback,
  EngineFact,
  EngineInput,
  EngineScenario,
  MetricValue,
} from "@credexis/engine";

export interface GoldenExpectation {
  metric: string;
  /** Entity slug from the deal's facts, or null for deal-global metrics. */
  entityId: string | null;
  /** Canonical period label, or null for non-period metrics. */
  periodLabel: string | null;
  value: MetricValue;
}

export interface GoldenDeal {
  id: string;
  synthetic: boolean;
  notes?: string;
  input: EngineInput;
  expected: GoldenExpectation[];
}

const ADDBACK_CATEGORIES: readonly AddbackCategory[] = [
  "officer_comp",
  "depreciation_amortization",
  "interest",
  "one_time",
  "rent_adjustment",
  "discretionary",
];

function fail(dealId: string, msg: string): never {
  throw new Error(`golden deal "${dealId}": ${msg}`);
}

function asRecord(dealId: string, v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    fail(dealId, `${path} must be an object`);
  }
  return v as Record<string, unknown>;
}

function asArray(dealId: string, v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(dealId, `${path} must be an array`);
  return v;
}

function asString(dealId: string, v: unknown, path: string): string {
  if (typeof v !== "string" || v.length === 0) fail(dealId, `${path} must be a non-empty string`);
  return v;
}

function asInt(dealId: string, v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) fail(dealId, `${path} must be an integer`);
  return v;
}

/** Integer-cent string ("22500000", may be negative) → branded Cents. */
function parseCents(dealId: string, v: unknown, path: string): Cents {
  const s = asString(dealId, v, path);
  if (!/^-?\d+$/.test(s)) {
    fail(dealId, `${path} must be an integer-cent string (got "${s}") — never dollars or floats`);
  }
  return cents(BigInt(s));
}

/** Decimal string ("1.88", "120", "0.1000") → FixedDecimal with implied scale. */
function parseRatio(dealId: string, v: unknown, path: string): MetricValue {
  const s = asString(dealId, v, path);
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    fail(dealId, `${path} must be a plain decimal string (got "${s}")`);
  }
  const scale = s.includes(".") ? s.length - s.indexOf(".") - 1 : 0;
  return { kind: "ratio", ratio: makeDecimal(BigInt(s.replace(".", "")), scale) };
}

function parseScenario(dealId: string, raw: unknown): EngineScenario {
  const o = asRecord(dealId, raw, "scenario");
  const scenario: EngineScenario = {
    amountCents: parseCents(dealId, o["amountCents"], "scenario.amountCents"),
    termMonths: asInt(dealId, o["termMonths"], "scenario.termMonths"),
    rateSteps: asArray(dealId, o["rateSteps"], "scenario.rateSteps").map((step, i) => {
      const r = asRecord(dealId, step, `scenario.rateSteps[${i}]`);
      return {
        fromMonth: asInt(dealId, r["fromMonth"], `scenario.rateSteps[${i}].fromMonth`),
        annualRateBps: asInt(dealId, r["annualRateBps"], `scenario.rateSteps[${i}].annualRateBps`),
      };
    }),
  };
  if (o["interestOnlyMonths"] !== undefined) {
    scenario.interestOnlyMonths = asInt(
      dealId,
      o["interestOnlyMonths"],
      "scenario.interestOnlyMonths",
    );
  }
  if (o["replacementSalaryCents"] !== undefined) {
    scenario.replacementSalaryCents = parseCents(
      dealId,
      o["replacementSalaryCents"],
      "scenario.replacementSalaryCents",
    );
  }
  if (o["structure"] !== undefined) {
    const st = asRecord(dealId, o["structure"], "scenario.structure");
    scenario.structure = {
      ...(st["equityInjectionCents"] !== undefined
        ? {
            equityInjectionCents: parseCents(
              dealId,
              st["equityInjectionCents"],
              "scenario.structure.equityInjectionCents",
            ),
          }
        : {}),
      ...(st["totalProjectCostCents"] !== undefined
        ? {
            totalProjectCostCents: parseCents(
              dealId,
              st["totalProjectCostCents"],
              "scenario.structure.totalProjectCostCents",
            ),
          }
        : {}),
      ...(st["sbaGuarantyBps"] !== undefined
        ? {
            sbaGuarantyBps: asInt(
              dealId,
              st["sbaGuarantyBps"],
              "scenario.structure.sbaGuarantyBps",
            ),
          }
        : {}),
    };
  }
  return scenario;
}

export function parseGoldenDeal(folderName: string, json: unknown): GoldenDeal {
  const o = asRecord(folderName, json, "deal.json");
  const id = asString(folderName, o["id"], "id");
  if (id !== folderName) {
    fail(folderName, `id "${id}" must match its folder name (corpus-integrity convention)`);
  }
  const synthetic = o["synthetic"] === true;
  if (synthetic !== id.startsWith("_synthetic-")) {
    fail(
      id,
      `synthetic deals must be named "_synthetic-*" and vice versa — a real deal may never masquerade as synthetic, nor a synthetic one as real (Iron Law #9)`,
    );
  }

  const facts: EngineFact[] = asArray(id, o["facts"], "facts").map((raw, i) => {
    const f = asRecord(id, raw, `facts[${i}]`);
    const entityId = asString(id, f["entityId"], `facts[${i}].entityId`);
    const periodLabel = asString(id, f["periodLabel"], `facts[${i}].periodLabel`);
    const key = asString(id, f["taxonomyNodeKey"], `facts[${i}].taxonomyNodeKey`);
    return {
      id: `${entityId}|${periodLabel}|${key}`,
      entityId,
      periodLabel,
      taxonomyNodeKey: key,
      valueCents: parseCents(id, f["valueCents"], `facts[${i}].valueCents`),
      // Golden inputs are the expert's finalized spread — highest human authority.
      method: "human",
      status: "accepted",
    };
  });
  if (facts.length === 0) fail(id, "facts must not be empty");

  const addbacks: EngineAddback[] = asArray(id, o["addbacks"] ?? [], "addbacks").map((raw, i) => {
    const a = asRecord(id, raw, `addbacks[${i}]`);
    const category = asString(id, a["category"], `addbacks[${i}].category`) as AddbackCategory;
    if (!ADDBACK_CATEGORIES.includes(category)) {
      fail(id, `addbacks[${i}].category "${category}" is not a known category`);
    }
    const entityId = asString(id, a["entityId"], `addbacks[${i}].entityId`);
    const periodLabel = asString(id, a["periodLabel"], `addbacks[${i}].periodLabel`);
    return {
      id: `${entityId}|${periodLabel}|${category}|${i}`,
      entityId,
      periodLabel,
      category,
      state: "accepted",
      amountCents: parseCents(id, a["amountCents"], `addbacks[${i}].amountCents`),
    };
  });

  const expected: GoldenExpectation[] = asArray(id, o["expected"], "expected").map((raw, i) => {
    const e = asRecord(id, raw, `expected[${i}]`);
    const metric = asString(id, e["metric"], `expected[${i}].metric`);
    const hasCents = e["cents"] !== undefined;
    const hasRatio = e["ratio"] !== undefined;
    if (hasCents === hasRatio) {
      fail(id, `expected[${i}] (${metric}) must have exactly one of "cents" or "ratio"`);
    }
    return {
      metric,
      entityId:
        e["entityId"] === null ? null : asString(id, e["entityId"], `expected[${i}].entityId`),
      periodLabel:
        e["periodLabel"] === null
          ? null
          : asString(id, e["periodLabel"], `expected[${i}].periodLabel`),
      value: hasCents
        ? { kind: "cents", cents: parseCents(id, e["cents"], `expected[${i}].cents`) }
        : parseRatio(id, e["ratio"], `expected[${i}].ratio`),
    };
  });
  if (expected.length === 0)
    fail(id, "expected must not be empty — a golden deal with no answers proves nothing");

  const deal: GoldenDeal = {
    id,
    synthetic,
    input: {
      facts,
      addbacks,
      scenario: o["scenario"] !== undefined ? parseScenario(id, o["scenario"]) : null,
    },
    expected,
  };
  if (typeof o["notes"] === "string") deal.notes = o["notes"];
  return deal;
}

/** Load every `<dir>/<deal>/deal.json`, validated; sorted by id. */
export async function loadGoldenDeals(goldenDir: string): Promise<GoldenDeal[]> {
  const entries = await readdir(goldenDir, { withFileTypes: true });
  const deals: GoldenDeal[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const raw = await readFile(join(goldenDir, entry.name, "deal.json"), "utf8");
    deals.push(parseGoldenDeal(entry.name, JSON.parse(raw)));
  }
  return deals.sort((a, b) => a.id.localeCompare(b.id));
}
