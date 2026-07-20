/**
 * Tax Spread assembly (M8.3 tax tab, ADR-0002 follow-up): pivot tax-form
 * facts into registry-keyed rows × period columns, grouped by form family.
 * Where the statement spread pivots on taxonomy nodes, tax facts pivot on
 * registry field ids — which is what lets registry-only facts (derived
 * lines like AGI with no taxonomy placement) render at all.
 *
 * Pure reshaping — no arithmetic (Iron Law #3).
 */

export interface TaxFactRow {
  id: string;
  registryFieldId: string;
  taxonomyNodeKey: string | null;
  periodLabel: string;
  valueCents: string;
  method: string;
  status: string;
  confidence: number | null;
  sourcePage: number | null;
  sourceLogicalDocumentId: string | null;
}

/** One registry field's display identity (from the Form Registry, M4.1). */
export interface RegistryRowMeta {
  fieldId: string;
  formFamily: string;
  lineNumber: string;
  label: string;
  taxonomyNodeKey: string | null;
}

export interface TaxSpreadCell {
  factId: string;
  valueCents: string;
  method: string;
  status: string;
  confidence: number | null;
  sourcePage: number | null;
  sourceLogicalDocumentId: string | null;
  /** M9.4: an IRS transcript fact corroborates the parsed value. */
  verifiedByTranscript: boolean;
}

export interface TaxSpreadRow {
  /** "form" = family header (no cells); "line" = one registry field. */
  kind: "form" | "line";
  /** Form family for headers; registry fieldId for lines. */
  key: string;
  formFamily: string;
  lineNumber: string | null;
  label: string;
  /** True when the line has no taxonomy placement (derived — AGI etc.). */
  registryOnly: boolean;
  cells: Record<string, TaxSpreadCell>;
}

/** Same authority order the statement spread uses (spread/logic.ts). */
const METHOD_RANK: Record<string, number> = {
  vendor: 0,
  llm: 0,
  consensus: 1,
  transcript: 2,
  human: 3,
  override: 4,
};

function better(a: TaxFactRow, b: TaxFactRow | undefined): boolean {
  if (!b) return true;
  if (a.status !== b.status) return a.status === "accepted";
  return (METHOD_RANK[a.method] ?? 0) > (METHOD_RANK[b.method] ?? 0);
}

export function assembleTaxSpread(
  meta: RegistryRowMeta[],
  facts: TaxFactRow[],
): { periods: string[]; rows: TaxSpreadRow[] } {
  const known = new Set(meta.map((m) => m.fieldId));
  const best = new Map<string, TaxFactRow>(); // fieldId|period → fact
  const periods = new Set<string>();
  const transcriptValues = new Map<string, string>(); // fieldId|period → cents
  const parsedValues = new Map<string, Set<string>>(); // fieldId|period → cents set

  for (const f of facts) {
    if (!known.has(f.registryFieldId)) continue; // registry is the row spec
    if (f.status !== "accepted" && f.status !== "suggested") continue;
    periods.add(f.periodLabel);
    const key = `${f.registryFieldId}|${f.periodLabel}`;
    if (better(f, best.get(key))) best.set(key, f);
    if (f.status === "accepted") {
      if (f.method === "transcript") transcriptValues.set(key, f.valueCents);
      else {
        const set = parsedValues.get(key) ?? new Set<string>();
        set.add(f.valueCents);
        parsedValues.set(key, set);
      }
    }
  }

  const sortedPeriods = [...periods].sort();
  const rows: TaxSpreadRow[] = [];
  let currentFamily: string | null = null;

  // meta arrives in registry order (form by form, line by line) — rows keep
  // that order; only populated lines (and their family header) render.
  for (const m of meta) {
    const cells: Record<string, TaxSpreadCell> = {};
    for (const p of sortedPeriods) {
      const key = `${m.fieldId}|${p}`;
      const f = best.get(key);
      if (!f) continue;
      const transcript = transcriptValues.get(key);
      cells[p] = {
        factId: f.id,
        valueCents: f.valueCents,
        method: f.method,
        status: f.status,
        confidence: f.confidence,
        sourcePage: f.sourcePage,
        sourceLogicalDocumentId: f.sourceLogicalDocumentId,
        verifiedByTranscript:
          transcript !== undefined && (parsedValues.get(key)?.has(transcript) ?? false),
      };
    }
    if (Object.keys(cells).length === 0) continue;

    if (m.formFamily !== currentFamily) {
      currentFamily = m.formFamily;
      rows.push({
        kind: "form",
        key: m.formFamily,
        formFamily: m.formFamily,
        lineNumber: null,
        label: m.formFamily,
        registryOnly: false,
        cells: {},
      });
    }
    rows.push({
      kind: "line",
      key: m.fieldId,
      formFamily: m.formFamily,
      lineNumber: m.lineNumber,
      label: m.label,
      registryOnly: m.taxonomyNodeKey === null,
      cells,
    });
  }

  return { periods: sortedPeriods, rows };
}
