/** Authoring helpers — keep the data files readable. */

import type { RegistryField } from "../types.js";

/** Money line with cents box (the IRS default for these forms). */
export function money(
  fieldId: string,
  lineNumber: string,
  label: string,
  opts: Partial<Omit<RegistryField, "fieldId" | "lineNumber" | "label" | "dtype">> = {},
): RegistryField {
  return {
    fieldId,
    lineNumber,
    label,
    dtype: "money",
    aliases: opts.aliases ?? [],
    pageHint: opts.pageHint ?? 1,
    sign: opts.sign ?? 1,
    hasCentsBox: opts.hasCentsBox ?? true,
    hint: opts.hint ?? null,
    taxonomyNodeKey: opts.taxonomyNodeKey ?? null,
  };
}

/** Identity TEXT field (M11.6): the printed taxpayer/business name. Located
 *  by the readers, matched deterministically in packages/shared — NEVER a
 *  fact (identities are not money) and never taxonomy-linked. */
export function identityText(fieldId: string, label: string, hint?: string): RegistryField {
  return {
    fieldId,
    lineNumber: "—",
    label,
    dtype: "text",
    aliases: [],
    pageHint: 1,
    sign: 1,
    hasCentsBox: false,
    hint: hint ?? null,
    taxonomyNodeKey: null,
  };
}
