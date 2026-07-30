"use client";

/**
 * Spread grid (M8.3, Blueprint §8.2): AG Grid over taxonomy rows × period
 * columns. Values render from integer-cent strings (Iron Law #3 — zero
 * client math; the violet computed rows come straight from the engine's
 * computed_metrics). Label edits teach the mapper (learned_mappings).
 *
 * Tree behavior is community-safe: flat rows + depth indent + a collapsed
 * set — no enterprise row grouping.
 */

import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellDoubleClickedEvent,
  type ColDef,
} from "ag-grid-community";
import { ChevronDown, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { formatCents } from "@/lib/money-display";
import { formatRatio } from "./metrics-strip";
import { credexisGridTheme, GRID_HEADER_HEIGHT, GRID_ROW_HEIGHT } from "@/lib/ag-grid-theme";

ModuleRegistry.registerModules([AllCommunityModule]);

/** Confidence dot (V1 ValueCellRenderer): thresholds are display bands
 *  only — comparisons, never arithmetic (Iron Law #3). */
function confidenceDotClass(confidence: number | null | undefined): string | null {
  if (confidence === null || confidence === undefined) return null;
  if (confidence >= 0.85) return "bg-primary";
  if (confidence >= 0.7) return "bg-severity-warning";
  return "bg-severity-critical";
}

/** Engine metrics that render as computed rows per tab. */
const COMPUTED_ROWS: Record<string, { metric: string; label: string }[]> = {
  is: [
    { metric: "revenue_total", label: "Total revenue (computed)" },
    { metric: "gross_profit", label: "Gross profit" },
    { metric: "net_income", label: "Net income" },
    { metric: "ebitda", label: "EBITDA" },
    { metric: "sde", label: "SDE / adjusted cash flow" },
    { metric: "cfads", label: "CFADS" },
  ],
  bs: [
    { metric: "working_capital", label: "Working capital" },
    { metric: "current_ratio", label: "Current ratio" },
    { metric: "tangible_net_worth", label: "Tangible net worth" },
    { metric: "debt_to_tnw", label: "Debt / TNW" },
  ],
  gcf: [
    { metric: "personal_cash_flow", label: "Personal cash flow" },
    { metric: "global_cash_flow", label: "Global cash flow" },
    { metric: "dscr_global", label: "DSCR (global)" },
  ],
  debt: [{ metric: "annual_debt_service", label: "Annual debt service (scenario)" }],
};

interface GridRow {
  key: string;
  label: string;
  depth: number;
  hasChildren: boolean;
  computed: boolean;
  cells: Record<
    string,
    {
      display: string;
      status?: string;
      confidence?: number | null;
      factId?: string;
      verified?: boolean;
    }
  >;
}

export interface CellSelection {
  factId: string;
  nodeKey: string;
  periodLabel: string;
}

export function SpreadGrid({
  dealId,
  entityId,
  statement,
  onSelectCell,
}: {
  dealId: string;
  entityId: string;
  statement: "is" | "bs" | "gcf" | "debt";
  onSelectCell?: (sel: CellSelection) => void;
}) {
  const spread = trpc.spread.forDeal.useQuery({ dealId, entityId, statement });
  const rename = trpc.spread.renameLabel.useMutation();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { rowData, columnDefs } = useMemo(() => {
    const data = spread.data;
    if (!data) return { rowData: [] as GridRow[], columnDefs: [] as ColDef<GridRow>[] };

    const isHidden = (key: string) =>
      [...collapsed].some((c) => key !== c && key.startsWith(`${c}.`));

    // Only rows with facts somewhere beneath them render — a 100-row empty
    // taxonomy is noise (and unscrollable in tests). Ancestors of any
    // populated row stay visible for structure.
    const populated = new Set<string>();
    for (const r of data.rows) {
      if (Object.keys(r.cells).length === 0) continue;
      const parts = r.key.split(".");
      for (let i = 1; i <= parts.length; i++) populated.add(parts.slice(0, i).join("."));
    }

    const rows: GridRow[] = data.rows
      .filter((r) => populated.has(r.key) && !isHidden(r.key))
      .map((r) => ({
        key: r.key,
        label: r.label,
        depth: r.depth,
        hasChildren: r.hasChildren,
        computed: false,
        cells: Object.fromEntries(
          Object.entries(r.cells).map(([p, c]) => [
            p,
            {
              display: formatCents(c.valueCents),
              status: c.status,
              confidence: c.confidence,
              factId: c.factId,
              verified: c.verifiedByTranscript,
            },
          ]),
        ),
      }));

    // Violet computed rows from the engine, appended under the taxonomy.
    for (const spec of COMPUTED_ROWS[statement] ?? []) {
      const cells: GridRow["cells"] = {};
      for (const m of data.computed.filter((c) => c.metric === spec.metric)) {
        const period = m.periodLabel ?? "—";
        cells[period] = {
          display:
            m.valueKind === "cents" && m.valueCents !== null
              ? formatCents(m.valueCents)
              : m.ratioMantissa !== null && m.ratioScale !== null
                ? formatRatio(m.ratioMantissa, m.ratioScale)
                : "—",
        };
      }
      if (Object.keys(cells).length > 0) {
        rows.push({
          key: `computed:${spec.metric}`,
          label: spec.label,
          depth: 0,
          hasChildren: false,
          computed: true,
          cells,
        });
      }
    }

    const periodSet = new Set<string>(data.periods);
    for (const r of rows) for (const p of Object.keys(r.cells)) periodSet.add(p);

    const cols: ColDef<GridRow>[] = [
      {
        field: "label",
        headerName: "",
        pinned: "left",
        width: 280,
        editable: (p) => !p.data?.computed,
        cellClass: (p) => (p.data?.computed ? "computed-row-accent" : ""),
        cellRenderer: (p: { data?: GridRow; value?: string }) => {
          const d = p.data;
          if (!d) return p.value;
          return (
            <span
              style={{ paddingLeft: d.depth * 14 }}
              className={
                d.computed
                  ? "inline-flex items-center gap-1.5 font-semibold text-computed"
                  : "inline-flex items-center gap-1"
              }
            >
              {d.hasChildren ? (
                collapsed.has(d.key) ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )
              ) : null}
              {p.value ?? ""}
              {d.computed ? <span className="sba-badge">SBA</span> : null}
            </span>
          );
        },
      },
      ...[...periodSet].sort().map(
        (p): ColDef<GridRow> => ({
          colId: p,
          headerName: p,
          width: 130,
          type: "rightAligned",
          valueGetter: (params) => {
            const cell = params.data?.cells[p];
            if (!cell) return "";
            return cell.verified ? `${cell.display} ✓IRS` : cell.display;
          },
          cellClass: (params) => {
            const cell = params.data?.cells[p];
            if (params.data?.computed) return "text-computed font-semibold font-mono tabular-nums";
            if (cell?.status === "suggested") return "text-severity-warning font-mono tabular-nums";
            return "font-mono tabular-nums";
          },
          cellRenderer: (params: { data?: GridRow; value?: string }) => {
            const cell = params.data?.cells[p];
            const dot = confidenceDotClass(cell?.confidence);
            return (
              <span className="inline-flex items-center gap-1.5">
                {params.value}
                {dot && !params.data?.computed ? (
                  <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                ) : null}
              </span>
            );
          },
          tooltipValueGetter: (params) => {
            const cell = params.data?.cells[p];
            if (!cell?.status) return "";
            const base = `${cell.status} · confidence ${cell.confidence ?? "—"}`;
            return cell.verified ? `${base} · verified by IRS transcript` : base;
          },
        }),
      ),
    ];
    return { rowData: rows, columnDefs: cols };
  }, [spread.data, collapsed, statement]);

  if (spread.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="grid-loader">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }
  if (spread.error) {
    return <p className="p-4 text-sm text-severity-critical">{spread.error.message}</p>;
  }

  return (
    <div className="credexis-grid h-full w-full">
      <AgGridReact<GridRow>
        rowData={rowData}
        columnDefs={columnDefs}
        getRowId={(p) => p.data.key}
        // AG Grid's stock "No Rows To Show" is the one string in the cockpit
        // we don't own — replace it with product voice (ui-17).
        overlayNoRowsTemplate={`<span style="color: var(--muted-foreground); font-size: 13px;">No accepted facts yet — rows appear as extraction lands and review accepts them.</span>`}
        theme={credexisGridTheme}
        headerHeight={GRID_HEADER_HEIGHT}
        rowHeight={GRID_ROW_HEIGHT}
        getRowStyle={(p) =>
          p.data?.computed
            ? {
                borderTop: "2px solid var(--computed)",
                background: "color-mix(in oklab, var(--computed) 8%, transparent)",
              }
            : undefined
        }
        tooltipShowDelay={300}
        onCellClicked={(e) => {
          const d = e.data;
          if (!d) return;
          if (e.colDef.field === "label" && d.hasChildren) {
            setCollapsed((prev) => {
              const next = new Set(prev);
              if (next.has(d.key)) next.delete(d.key);
              else next.add(d.key);
              return next;
            });
            return;
          }
          const cell = e.colDef.colId ? d.cells[e.colDef.colId] : undefined;
          if (cell?.factId && e.colDef.colId) {
            onSelectCell?.({ factId: cell.factId, nodeKey: d.key, periodLabel: e.colDef.colId });
          }
        }}
        onCellDoubleClicked={(_e: CellDoubleClickedEvent<GridRow>) => undefined}
        onCellValueChanged={(e) => {
          if (e.colDef.field === "label" && e.data && !e.data.computed && e.newValue) {
            rename.mutate({ nodeKey: e.data.key, label: String(e.newValue) });
          }
        }}
      />
    </div>
  );
}
