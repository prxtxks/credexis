/**
 * Spread assembly (M8.3): pivot facts into taxonomy rows × period columns.
 * Pure reshaping — no arithmetic (Iron Law #3); the engine's computed rows
 * arrive separately from computed_metrics.
 *
 * Cell selection: the best ACCEPTED fact per (node, period) by method
 * authority; if none, the best SUGGESTED fact (rendered as pending —
 * the review queue owns it). Rejected/overridden rows never show.
 */

export interface SpreadFactRow {
  id: string;
  taxonomyNodeKey: string | null;
  periodLabel: string;
  valueCents: string;
  method: string;
  status: string;
  confidence: number | null;
  sourcePage: number | null;
  sourceLogicalDocumentId: string | null;
}

export interface TaxonomyNodeRow {
  key: string;
  parentKey: string | null;
  label: string;
  sortOrder: number;
  isAddbackRelevant: boolean;
}

export interface SpreadCell {
  factId: string;
  valueCents: string;
  method: string;
  status: string;
  confidence: number | null;
  sourcePage: number | null;
  sourceLogicalDocumentId: string | null;
}

export interface SpreadRow {
  key: string;
  label: string;
  depth: number;
  hasChildren: boolean;
  isAddbackRelevant: boolean;
  cells: Record<string, SpreadCell>;
}

const METHOD_RANK: Record<string, number> = {
  vendor: 0,
  llm: 0,
  consensus: 1,
  transcript: 2,
  human: 3,
  override: 4,
};

function better(a: SpreadFactRow, b: SpreadFactRow | undefined): boolean {
  if (!b) return true;
  // Accepted always beats suggested; within a status, authority wins.
  if (a.status !== b.status) return a.status === "accepted";
  return (METHOD_RANK[a.method] ?? 0) > (METHOD_RANK[b.method] ?? 0);
}

export function assembleSpread(
  nodes: TaxonomyNodeRow[],
  facts: SpreadFactRow[],
): { periods: string[]; rows: SpreadRow[] } {
  const best = new Map<string, SpreadFactRow>(); // node|period → fact
  const periods = new Set<string>();

  for (const f of facts) {
    if (f.taxonomyNodeKey === null) continue;
    if (f.status !== "accepted" && f.status !== "suggested") continue;
    periods.add(f.periodLabel);
    const key = `${f.taxonomyNodeKey}|${f.periodLabel}`;
    if (better(f, best.get(key))) best.set(key, f);
  }

  const depth = (key: string) => key.split(".").length - 1;
  const childCount = new Map<string, number>();
  for (const n of nodes) {
    if (n.parentKey) childCount.set(n.parentKey, (childCount.get(n.parentKey) ?? 0) + 1);
  }

  const sortedPeriods = [...periods].sort();
  const rows: SpreadRow[] = [...nodes]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((n) => {
      const cells: Record<string, SpreadCell> = {};
      for (const p of sortedPeriods) {
        const f = best.get(`${n.key}|${p}`);
        if (f) {
          cells[p] = {
            factId: f.id,
            valueCents: f.valueCents,
            method: f.method,
            status: f.status,
            confidence: f.confidence,
            sourcePage: f.sourcePage,
            sourceLogicalDocumentId: f.sourceLogicalDocumentId,
          };
        }
      }
      return {
        key: n.key,
        label: n.label,
        depth: depth(n.key),
        hasChildren: (childCount.get(n.key) ?? 0) > 0,
        isAddbackRelevant: n.isAddbackRelevant,
        cells,
      };
    });

  return { periods: sortedPeriods, rows };
}

/** Normalization the taxonomy mapper uses — renames must match it. */
export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}
