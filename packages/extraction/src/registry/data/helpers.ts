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
