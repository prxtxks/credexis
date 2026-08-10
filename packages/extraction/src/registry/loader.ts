/**
 * Form Registry loader (M4.1): expands FormDefinitions (base year +
 * per-year overrides) into validated (form_family, tax_year) entries and
 * bridges them into the ExtractorAdapter's FieldRequest shape.
 *
 * Everything is validated through zod at first access — a malformed data
 * file fails every test, not one deal at 2am.
 */

import type { FormFamily } from "@credexis/schema";
import {
  registryEntrySchema,
  type CrossFormFlow,
  type FormDefinition,
  type InFormRelation,
  type RegistryEntry,
} from "./types.js";
import type { FieldRequest } from "../types.js";
import { F1120, F1120S, F1065 } from "./data/business-returns.js";
import { F1040, F1040_SCH_1, F1040_SCH_C, F1040_SCH_E } from "./data/personal-returns.js";
import { F1125E, F4562, F8825, K1_1065, K1_1120S, W2 } from "./data/attachments.js";

export const REGISTRY_DEFINITIONS: FormDefinition[] = [
  F1120S,
  F1120,
  F1065,
  F1040,
  F1040_SCH_1,
  F1040_SCH_C,
  F1040_SCH_E,
  F4562,
  F8825,
  F1125E,
  K1_1120S,
  K1_1065,
  W2,
];

export const REGISTRY_TAX_YEARS = [2023, 2024, 2025] as const;

function expand(def: FormDefinition, taxYear: number): RegistryEntry {
  const override = def.overrides?.[taxYear];
  // Fields, relations, and flows all replace WHOLESALE when given: an
  // override year states its complete truth. (Merge-by-fieldId was the
  // original semantics, but it cannot express a REMOVED line - the §179D
  // field does not exist on pre-2023 forms, M14.4 - and a half-merged
  // year is harder to audit than a full list.)
  return registryEntrySchema.parse({
    formFamily: def.formFamily,
    taxYear,
    revision: 1,
    fields: override?.fields ?? def.base.fields,
    relations: override?.relations ?? def.base.relations,
    flows: override?.flows ?? def.base.flows,
  });
}

let cache: Map<string, RegistryEntry> | null = null;

function registry(): Map<string, RegistryEntry> {
  if (cache) return cache;
  cache = new Map();
  for (const def of REGISTRY_DEFINITIONS) {
    const years = new Set<number>([def.baseYear, ...Object.keys(def.overrides ?? {}).map(Number)]);
    for (const year of years) {
      cache.set(`${def.formFamily}:${year}`, expand(def, year));
    }
  }
  return cache;
}

/** The lookup every extraction stage uses. Null = form/year not seeded. */
export function getRegistryEntry(formFamily: FormFamily, taxYear: number): RegistryEntry | null {
  return registry().get(`${formFamily}:${taxYear}`) ?? null;
}

export function listRegistryEntries(): RegistryEntry[] {
  return [...registry().values()];
}

/** A gate spec annotated with the tax years whose registry carries exactly
 *  this content. `taxYears` is derived, never authored - drift-proof. */
export type YearScopedRelation = InFormRelation & { taxYears: number[] };
export type YearScopedFlow = CrossFormFlow & { taxYears: number[] };

/**
 * Gate wiring (M6.1 G4 ← M4.1 data): every registry relation and cross-form
 * flow, deduped by CONTENT and annotated with the tax years that carry that
 * content. The 2023 §179D renumbering (M14.4) made the same relation id
 * legitimately divergent across years - "total deductions" sums different
 * operand sets pre/post 2023 - so first-id-wins became unsound: the engine
 * skips a relation when any operand fact is missing, and a pre-2023 subset
 * relation would false-positive on a 2023 return that claims §179D. The
 * gate loop filters by the period's fiscal year instead (periods are
 * labelled FY<year> by the extract stage).
 */
export function registryGateSpecs(): { relations: YearScopedRelation[]; flows: YearScopedFlow[] } {
  const relations = new Map<string, YearScopedRelation>();
  const flows = new Map<string, YearScopedFlow>();
  const keyOf = (spec: object) =>
    JSON.stringify(spec, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
  for (const entry of listRegistryEntries()) {
    for (const rel of entry.relations) {
      const key = keyOf(rel);
      const existing = relations.get(key);
      if (existing) existing.taxYears.push(entry.taxYear);
      else relations.set(key, { ...rel, taxYears: [entry.taxYear] });
    }
    for (const flow of entry.flows) {
      const key = keyOf(flow);
      const existing = flows.get(key);
      if (existing) existing.taxYears.push(entry.taxYear);
      else flows.set(key, { ...flow, taxYears: [entry.taxYear] });
    }
  }
  for (const spec of [...relations.values(), ...flows.values()]) {
    spec.taxYears = [...new Set(spec.taxYears)].sort((a, b) => a - b);
  }
  return { relations: [...relations.values()], flows: [...flows.values()] };
}

/** Bridge into the ExtractorAdapter contract (M3.3) — M4.2/M4.3 use this. */
export function toFieldRequests(entry: RegistryEntry): FieldRequest[] {
  return entry.fields.map((f) => ({
    fieldId: f.fieldId,
    label: f.label,
    aliases: f.aliases,
    pageHint: f.pageHint,
    ...(f.hint ? { hint: f.hint } : {}),
    dtype: f.dtype,
    hasCentsBox: f.hasCentsBox,
  }));
}
