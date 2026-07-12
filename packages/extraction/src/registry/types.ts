/**
 * Form Registry types (M4.1, Blueprint §4.2) — the antidote to V1's
 * regex-on-"line 31" (post-mortem trap 2).
 *
 * A versioned data catalog: for each (form_family, tax_year) → the field
 * list with IRS line number, label aliases, page hint, dtype, sign, and
 * validation relations. IRS renumbers lines across years — the registry
 * absorbs that; code never hardcodes a line number. New forms are new
 * registry entries, not new code.
 */

import { z } from "zod";
import { formFamilySchema } from "@credexis/schema";

export const registryDtypeSchema = z.enum(["money", "integer", "percent", "text", "date"]);

export const registryFieldSchema = z.object({
  /** Stable id, e.g. "f1120s.line21" — never reused for a different meaning. */
  fieldId: z.string().regex(/^[a-z0-9]+\.[a-z0-9_]+$/),
  /** The printed line/box number for THIS tax year ("21", "16a", "1"). */
  lineNumber: z.string().min(1),
  label: z.string().min(1),
  /** Label variants + vendor field names (Azure DI keys go here). */
  aliases: z.array(z.string()).default([]),
  /** 1-based page hint within the form (advisory). */
  pageHint: z.number().int().min(1).default(1),
  dtype: registryDtypeSchema,
  /**
   * Natural sign multiplier when the printed value enters aggregation:
   * +1 for income/deduction lines as printed, -1 for lines whose printed
   * positive means subtraction (e.g. returns & allowances).
   */
  sign: z.union([z.literal(1), z.literal(-1)]).default(1),
  /** IRS money fields with a separate cents box. */
  hasCentsBox: z.boolean().default(false),
  /** Canonical taxonomy node this line maps to (fact writing, M4.5). */
  taxonomyNodeKey: z.string().nullable().default(null),
});
export type RegistryField = z.infer<typeof registryFieldSchema>;

/**
 * In-form arithmetic relations, evaluated as G1/G4 signals (Blueprint §4.2
 * "registry cross-field relations run as a third check"). All in cents.
 */
export const inFormRelationSchema = z.object({
  id: z.string().min(1),
  /** result ≈ Σ(operands[i] × signs from field defs) within tolerance. */
  type: z.enum(["sum", "difference"]),
  result: z.string(),
  operands: z.array(z.string()).min(1),
  toleranceCents: z.bigint().default(100n), // ±$1 default
  description: z.string(),
});
export type InFormRelation = z.infer<typeof inFormRelationSchema>;

/** Cross-form flows ("4562 line 22 → parent return's depreciation line"). */
export const crossFormFlowSchema = z.object({
  id: z.string().min(1),
  fromField: z.string(),
  toFamily: formFamilySchema,
  toField: z.string(),
  toleranceCents: z.bigint().default(0n), // exact per Blueprint §4.5 G4
  description: z.string(),
});
export type CrossFormFlow = z.infer<typeof crossFormFlowSchema>;

export const registryEntrySchema = z
  .object({
    formFamily: formFamilySchema,
    taxYear: z.number().int().min(2015).max(2035),
    /** Bumped when a year's field list is corrected post-release. */
    revision: z.number().int().min(1).default(1),
    fields: z.array(registryFieldSchema).min(1),
    relations: z.array(inFormRelationSchema).default([]),
    /** Flows FROM this form into a parent form. */
    flows: z.array(crossFormFlowSchema).default([]),
  })
  .superRefine((entry, ctx) => {
    const ids = new Set<string>();
    for (const f of entry.fields) {
      if (ids.has(f.fieldId)) {
        ctx.addIssue({ code: "custom", message: `duplicate fieldId ${f.fieldId}` });
      }
      ids.add(f.fieldId);
    }
    for (const r of entry.relations) {
      for (const ref of [r.result, ...r.operands]) {
        if (!ids.has(ref)) {
          ctx.addIssue({ code: "custom", message: `relation ${r.id} references unknown ${ref}` });
        }
      }
    }
    for (const fl of entry.flows) {
      if (!ids.has(fl.fromField)) {
        ctx.addIssue({
          code: "custom",
          message: `flow ${fl.id} references unknown ${fl.fromField}`,
        });
      }
    }
  });
export type RegistryEntry = z.infer<typeof registryEntrySchema>;

/**
 * Authoring shape: a base year plus per-year overrides. The IRS kept these
 * forms' line numbers stable across 2023–2025; when a renumbering lands,
 * the override carries it and code changes nowhere.
 */
export interface FormDefinition {
  formFamily: z.infer<typeof formFamilySchema>;
  baseYear: number;
  base: Omit<RegistryEntry, "formFamily" | "taxYear" | "revision">;
  /** taxYear → partial replacement (fields fully replace by fieldId). */
  overrides?: Record<
    number,
    Partial<Pick<RegistryEntry, "relations" | "flows">> & { fields?: RegistryField[] }
  >;
}
