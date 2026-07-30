/**
 * Document assignment (M6.5): pure decision logic for confirming/fixing the
 * Stage-S split suggestions (form family, tax year, entity). The router is a
 * thin RLS-scoped binding; the audit trigger (0005) records every change
 * with actor + before/after.
 */

import { ASSIGNABLE_FAMILIES } from "@/lib/form-families";

export { ASSIGNABLE_FAMILIES };

/** Sanity bounds only - a tax year outside these is a typo, not a filing. */
const TAX_YEAR_MIN = 2000;
const TAX_YEAR_MAX = 2035;

export interface AssignmentInput {
  /** New form family; must be in ASSIGNABLE_FAMILIES. */
  formFamily?: string;
  /** New tax year; null clears it. */
  taxYear?: number | null;
  /**
   * Entity assignment: a uuid confirms that entity (entity_confirmed=true);
   * null clears the suggestion (entity_confirmed=false); undefined = untouched.
   */
  entityId?: string | null;
}

/**
 * Build the logical_documents patch for one assignment decision.
 * Throws on an empty or invalid decision - the router maps to BAD_REQUEST.
 */
export function buildAssignmentPatch(input: AssignmentInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (input.formFamily !== undefined) {
    if (!ASSIGNABLE_FAMILIES.includes(input.formFamily)) {
      throw new Error(`unknown form family: ${input.formFamily}`);
    }
    patch["form_family"] = input.formFamily;
  }

  if (input.taxYear !== undefined) {
    if (input.taxYear !== null) {
      if (
        !Number.isInteger(input.taxYear) ||
        input.taxYear < TAX_YEAR_MIN ||
        input.taxYear > TAX_YEAR_MAX
      ) {
        throw new Error(`tax year out of range: ${input.taxYear}`);
      }
    }
    patch["tax_year"] = input.taxYear;
  }

  if (input.entityId !== undefined) {
    patch["entity_id"] = input.entityId;
    // A human either confirmed a concrete entity or explicitly un-assigned;
    // both are decisions, but only a concrete entity counts as confirmed.
    patch["entity_confirmed"] = input.entityId !== null;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("empty assignment: nothing to change");
  }
  return patch;
}
