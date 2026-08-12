/**
 * Structure validation (M5.5, Blueprint §4.3 step 5): the mapped tree is
 * re-aggregated numerically — parsed subtotals must equal computed
 * subtotals (±$1/level, G1), balance sheets must balance (A = L + E, ±$2,
 * G2). Violations become issue objects; V1 computed checks and showed
 * nothing (post-mortem trap 9) — these feed the blocking gate engine
 * (M6.1) and the workspace Issues panel.
 */

import { mulCentsByInt, type Cents } from "@credexis/shared";
import type { Bbox } from "../types.js";
import type { TypedRow } from "./row-typing.js";
import type { PeriodBinding } from "./period-binding.js";
import type { MappedLabel } from "./taxonomy-mapper.js";

export interface StructureIssue {
  gate: "G1" | "G2";
  severity: "error";
  columnId: number;
  periodLabel: string | null;
  rowLabel: string | null;
  message: string;
  deltaCents: bigint;
}

export interface StatementFactDraft {
  taxonomyNodeKey: string;
  periodLabel: string;
  /** Unit-scaled integer cents ("in thousands" already applied). */
  valueCents: Cents;
  page: number;
  /** The value CELL's geometry (M14.7) - click-to-source highlights the
   *  number the way tax-path facts always could. Null when the vendor
   *  gave no cell box. */
  bbox: Bbox | null;
  sourceLabel: string;
  mappingMethod: MappedLabel["method"];
}

export interface StructureValidationResult {
  issues: StructureIssue[];
  /** Item-row facts for mapped labels with bound periods (pipeline input). */
  facts: StatementFactDraft[];
  /** Rows needing review: unmapped labels or unbound columns encountered. */
  unmappedLabels: string[];
}

const G1_TOLERANCE = 100n; // ±$1/level
const G2_TOLERANCE = 200n; // ±$2

const abs = (v: bigint) => (v < 0n ? -v : v);

function periodLabelFor(binding: PeriodBinding, col: number): string | null {
  return binding.byColumn.get(col)?.label ?? null;
}

/**
 * Validate one typed+bound+mapped statement grid (page-scoped).
 * `mapped` is keyed by the ROW LABEL as it appears in the grid.
 */
export function validateStructure(
  typedRows: TypedRow[],
  binding: PeriodBinding,
  mapped: Map<string, MappedLabel>,
  opts: { statement: "PNL" | "BALANCE_SHEET"; page: number },
): StructureValidationResult {
  const issues: StructureIssue[] = [];
  // Drafts carry their row type until the double-count pass below decides
  // which survive as facts.
  const pending: Array<
    StatementFactDraft & { rowType: "item" | "subtotal" | "total"; col: number; rawCents: bigint }
  > = [];
  const unmappedLabels = new Set<string>();
  const headerRows = new Set(binding.headerRowIndexes);

  // Node totals per column for the semantic checks (NI, A=L+E).
  const nodeValue = new Map<string, Map<number, bigint>>();
  const record = (node: string, col: number, v: bigint) => {
    let m = nodeValue.get(node);
    if (!m) {
      m = new Map();
      nodeValue.set(node, m);
    }
    m.set(col, (m.get(col) ?? 0n) + v);
  };

  // ── G1: re-aggregate item blocks independently of M5.2's typing ────
  const itemBlock = new Map<number, bigint>();
  let itemsInBlock = 0;

  for (const t of typedRows) {
    if (headerRows.has(t.row.rowIndex)) continue;

    if (t.type === "header") {
      itemBlock.clear();
      itemsInBlock = 0;
      continue;
    }

    if (t.type === "item") {
      for (const [col, v] of t.valuesCents) {
        if (v !== null) itemBlock.set(col, (itemBlock.get(col) ?? 0n) + v);
      }
      if ([...t.valuesCents.values()].some((v) => v !== null)) itemsInBlock++;

      // Item facts: mapped node + bound period → fact draft.
      const mapping = mapped.get(t.row.label);
      if (!mapping || mapping.taxonomyNodeKey === null) {
        if (t.row.label !== "") unmappedLabels.add(t.row.label);
      } else {
        for (const [col, v] of t.valuesCents) {
          if (v === null) continue;
          record(mapping.taxonomyNodeKey, col, v);
          const period = binding.byColumn.get(col);
          if (period) {
            pending.push({
              taxonomyNodeKey: mapping.taxonomyNodeKey,
              periodLabel: period.label,
              valueCents: mulCentsByInt(v, BigInt(binding.scale)),
              page: opts.page,
              bbox: t.row.cells.get(col)?.bbox ?? null,
              sourceLabel: t.row.label,
              mappingMethod: mapping.method,
              rowType: "item",
              col,
              rawCents: v,
            });
          }
        }
      }
      continue;
    }

    if (t.type === "subtotal" || t.type === "total") {
      const mapping = mapped.get(t.row.label);
      if (mapping?.taxonomyNodeKey) {
        for (const [col, v] of t.valuesCents) {
          if (v !== null) {
            record(mapping.taxonomyNodeKey, col, v);
            // Totals are facts too (bake-off finding): the G1 gate checks
            // .total nodes against their children, which requires the
            // total fact to EXIST — and underwriters read totals first.
            const period = binding.byColumn.get(col);
            if (period) {
              pending.push({
                taxonomyNodeKey: mapping.taxonomyNodeKey,
                periodLabel: period.label,
                valueCents: mulCentsByInt(v, BigInt(binding.scale)),
                page: opts.page,
                bbox: t.row.cells.get(col)?.bbox ?? null,
                sourceLabel: t.row.label,
                mappingMethod: mapping.method,
                rowType: t.type,
                col,
                rawCents: v,
              });
            }
          }
        }
      } else if (t.row.label !== "") {
        unmappedLabels.add(t.row.label);
      }
      // Parsed vs computed (only meaningful when a block precedes it and
      // M5.2 could not verify it — verified rows already proved themselves).
      if (!t.numericallyVerified && t.type === "subtotal" && itemsInBlock > 0) {
        for (const [col, v] of t.valuesCents) {
          if (v === null) continue;
          const computed = itemBlock.get(col) ?? 0n;
          const delta = abs(computed - v);
          if (delta > G1_TOLERANCE) {
            issues.push({
              gate: "G1",
              severity: "error",
              columnId: col,
              periodLabel: periodLabelFor(binding, col),
              rowLabel: t.row.label,
              message: `"${t.row.label}" ≠ sum of its section (off by ${delta}¢)`,
              deltaCents: delta,
            });
          }
        }
      }
      itemBlock.clear();
      itemsInBlock = 0;
    }
  }

  // ── Hierarchical double-count suppression (annual P&L, 2026-07-22) ──
  // QuickBooks sections put detail rows AND their section total on the
  // SAME taxonomy node (no finer node exists for Electric/Water). Per
  // (node, period): a total/subtotal row beats item rows; identical-value
  // totals collapse to one; different-value totals are ambiguity — no
  // fact, G1 issue (never guess). Item-only groups keep aggregating
  // (two independent misc accounts are genuinely additive).
  const byKey = new Map<string, typeof pending>();
  for (const d of pending) {
    const k = `${d.taxonomyNodeKey}|${d.periodLabel}`;
    const g = byKey.get(k);
    if (g) g.push(d);
    else byKey.set(k, [d]);
  }
  const facts: StatementFactDraft[] = [];
  nodeValue.clear();
  const keep = (d: (typeof pending)[number]) => {
    const { rowType: _t, col, rawCents, ...draft } = d;
    facts.push(draft);
    record(draft.taxonomyNodeKey, col, rawCents);
  };
  for (const group of byKey.values()) {
    const totals = group.filter((d) => d.rowType !== "item");
    if (totals.length === 0) {
      for (const d of group) keep(d);
      continue;
    }
    const distinct = new Set(totals.map((d) => d.valueCents.toString()));
    if (distinct.size > 1) {
      const first = totals[0]!;
      issues.push({
        gate: "G1",
        severity: "error",
        columnId: first.col,
        periodLabel: first.periodLabel,
        rowLabel: first.sourceLabel,
        message:
          `conflicting total rows for ${first.taxonomyNodeKey}: ` +
          totals.map((d) => `"${d.sourceLabel}" (${d.valueCents}¢)`).join(" vs "),
        deltaCents: abs(BigInt([...distinct][0]!) - BigInt([...distinct][1]!)),
      });
      continue; // ambiguity → review owns it, no fact
    }
    // Direction test: a covering total must be ≥ the items it claims to
    // cover. A total SMALLER than its same-node items is a misfiled
    // mapping (e.g. a section total landing on an unrelated item's node)
    // — the items win and the total routes to review.
    const items = group.filter((d) => d.rowType === "item");
    const sumItems = items.reduce((s, d) => s + d.valueCents, 0n);
    const total = totals[0]!;
    if (items.length > 0 && sumItems > total.valueCents + G1_TOLERANCE) {
      for (const d of items) keep(d);
      unmappedLabels.add(total.sourceLabel);
      continue;
    }
    keep(total);
  }

  // ── Semantic total check: Net Income = Total Income − Total Expenses ─
  if (opts.statement === "PNL") {
    const ni = nodeValue.get("is.net_income");
    const rev = nodeValue.get("is.revenue.total");
    const exp = nodeValue.get("is.opex.total");
    if (ni && rev && exp) {
      for (const [col, stated] of ni) {
        const r = rev.get(col);
        const e = exp.get(col);
        if (r === undefined || e === undefined) continue;
        const delta = abs(r - e - stated);
        if (delta > G1_TOLERANCE) {
          issues.push({
            gate: "G1",
            severity: "error",
            columnId: col,
            periodLabel: periodLabelFor(binding, col),
            rowLabel: "Net Income",
            message: `Net income ≠ total income − total expenses (off by ${delta}¢)`,
            deltaCents: delta,
          });
        }
      }
    }
  }

  // ── G2: A = L + E per period (±$2) ──────────────────────────────────
  if (opts.statement === "BALANCE_SHEET") {
    const assets = nodeValue.get("bs.assets.total");
    const combined = nodeValue.get("bs.total_liabilities_equity");
    const liabilities = nodeValue.get("bs.liabilities.total");
    const equity = nodeValue.get("bs.equity.total");
    if (assets) {
      for (const [col, a] of assets) {
        let rhs: bigint | undefined = combined?.get(col);
        if (rhs === undefined) {
          const l = liabilities?.get(col);
          const e = equity?.get(col);
          if (l !== undefined && e !== undefined) rhs = l + e;
        }
        if (rhs === undefined) continue;
        const delta = abs(a - rhs);
        if (delta > G2_TOLERANCE) {
          issues.push({
            gate: "G2",
            severity: "error",
            columnId: col,
            periodLabel: periodLabelFor(binding, col),
            rowLabel: null,
            message: `Assets ≠ Liabilities + Equity (off by ${delta}¢)`,
            deltaCents: delta,
          });
        }
      }
    }
  }

  return { issues, facts, unmappedLabels: [...unmappedLabels] };
}
