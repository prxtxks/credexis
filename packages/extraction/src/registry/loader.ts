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
  // Fields replace by fieldId; relations/flows replace wholesale if given.
  let fields = def.base.fields;
  if (override?.fields) {
    const byId = new Map(fields.map((f) => [f.fieldId, f]));
    for (const f of override.fields) byId.set(f.fieldId, f);
    fields = [...byId.values()];
  }
  return registryEntrySchema.parse({
    formFamily: def.formFamily,
    taxYear,
    revision: 1,
    fields,
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

/**
 * Gate wiring (M6.1 G4 ← M4.1 data): every registry relation and cross-form
 * flow as one flat, id-deduped list — the data shape the engine's GateConfig
 * consumes. Ids repeat across tax years (2023–2025 share definitions);
 * first-wins is safe ONLY while no year override rewrites a relation — the
 * registry test pins that invariant, so a divergent override fails CI and
 * forces period-aware gate config instead of silently mixing years.
 */
export function registryGateSpecs(): { relations: InFormRelation[]; flows: CrossFormFlow[] } {
  const relations = new Map<string, InFormRelation>();
  const flows = new Map<string, CrossFormFlow>();
  for (const entry of listRegistryEntries()) {
    for (const rel of entry.relations) if (!relations.has(rel.id)) relations.set(rel.id, rel);
    for (const flow of entry.flows) if (!flows.has(flow.id)) flows.set(flow.id, flow);
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
