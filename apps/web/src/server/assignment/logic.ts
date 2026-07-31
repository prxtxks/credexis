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

/* ── Span editing (M13.5): the reviewer owns the page ranges too ─────── */

export interface SpanRange {
  id: string;
  pageStart: number;
  pageEnd: number;
}

/**
 * Validate an edited page range against the span's siblings on the same
 * physical document. Overlaps are rejected - two logical documents cannot
 * claim the same page; a page the splitter missed CAN be claimed (gaps
 * are legal - cover sheets belong to nobody).
 */
export function validateSpanEdit(
  target: SpanRange,
  siblings: readonly SpanRange[],
  pageStart: number,
  pageEnd: number,
): { page_start: number; page_end: number } {
  if (
    !Number.isInteger(pageStart) ||
    !Number.isInteger(pageEnd) ||
    pageStart < 1 ||
    pageEnd < pageStart
  ) {
    throw new Error(`invalid page range: ${pageStart}-${pageEnd}`);
  }
  for (const s of siblings) {
    if (s.id === target.id) continue;
    if (pageStart <= s.pageEnd && s.pageStart <= pageEnd) {
      throw new Error(
        `pages ${pageStart}-${pageEnd} overlap the existing ${s.pageStart}-${s.pageEnd} span`,
      );
    }
  }
  return { page_start: pageStart, page_end: pageEnd };
}

/**
 * Split one span at a page: the original keeps [start, at-1]; the new span
 * takes [at, end] with the same labels but nothing confirmed - the human
 * relabels whichever half the splitter got wrong.
 */
export function splitSpanAt(
  target: { pageStart: number; pageEnd: number },
  atPage: number,
): { patch: { page_end: number }; newSpan: { page_start: number; page_end: number } } {
  if (!Number.isInteger(atPage) || atPage <= target.pageStart || atPage > target.pageEnd) {
    throw new Error(
      `split page must be between ${target.pageStart + 1} and ${target.pageEnd} (got ${atPage})`,
    );
  }
  return {
    patch: { page_end: atPage - 1 },
    newSpan: { page_start: atPage, page_end: target.pageEnd },
  };
}

/**
 * Merge one span into its neighbour (M13.5): the inverse of split, so a
 * reviewer who divides a form by mistake is never stranded. Only ADJACENT
 * spans on the same physical document merge - a gap between them would
 * silently swallow pages neither span claimed, and the reviewer should
 * see that gap and decide.
 *
 * The lower span survives and absorbs the upper's range; the caller
 * re-points the absorbed span's children (facts, pages, identities)
 * before deleting it. Re-pointing preserves lineage truth: a fact still
 * cites the same physical page and bbox - only the logical grouping,
 * which is exactly what the reviewer is correcting, changes.
 */
export function planSpanMerge(
  a: SpanRange,
  b: SpanRange,
): { survivorId: string; absorbedId: string; patch: { page_start: number; page_end: number } } {
  const [lower, upper] = a.pageStart <= b.pageStart ? [a, b] : [b, a];
  if (lower.id === upper.id) throw new Error("cannot merge a span with itself");
  if (upper.pageStart !== lower.pageEnd + 1) {
    throw new Error(
      `only adjacent spans merge: ${lower.pageStart}-${lower.pageEnd} and ${upper.pageStart}-${upper.pageEnd} are not neighbours`,
    );
  }
  return {
    survivorId: lower.id,
    absorbedId: upper.id,
    patch: { page_start: lower.pageStart, page_end: upper.pageEnd },
  };
}
