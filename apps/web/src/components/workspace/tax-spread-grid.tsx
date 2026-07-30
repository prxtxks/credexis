"use client";

/**
 * Tax Spread grid (M8.3 tax tab, ADR-0002 follow-up): registry-line rows
 * grouped by form family × period columns. Renders integer-cent strings
 * only (Iron Law #3 - zero client math). Registry-only lines (no taxonomy
 * placement - line 1a when 1c is the mapped line, AGI, taxable income)
 * carry a "tax-only" chip: they exist for G4/G5 verification and never
 * aggregate into statements. The chip was renamed from "derived" (M13.2,
 * first-deal walkthrough): these values are read off the page, and
 * telling an underwriter otherwise inverts the truth - "derived" is
 * reserved for values the engine computes.
 */

import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import { GridLoader } from "@/components/ui/grid-loader";
import { AllCommunityModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import { trpc } from "@/lib/trpc/client";
import { formatCents } from "@/lib/money-display";
import type { CellSelection } from "./spread-grid";
import {
  credexisGridTheme,
  GRID_HEADER_HEIGHT,
  GRID_ROW_HEIGHT,
  moneyColumnWidth,
} from "@/lib/ag-grid-theme";

ModuleRegistry.registerModules([AllCommunityModule]);

interface TaxGridRow {
  key: string;
  isForm: boolean;
  lineNumber: string | null;
  label: string;
  registryOnly: boolean;
  cells: Record<
    string,
    {
      display: string;
      status: string;
      confidence: number | null;
      factId: string;
      verified: boolean;
    }
  >;
}

export function TaxSpreadGrid({
  dealId,
  entityId,
  onSelectCell,
}: {
  dealId: string;
  entityId: string;
  onSelectCell?: (sel: CellSelection) => void;
}) {
  const spread = trpc.spread.taxForDeal.useQuery({ dealId, entityId });

  const { rowData, columnDefs } = useMemo(() => {
    const data = spread.data;
    if (!data) return { rowData: [] as TaxGridRow[], columnDefs: [] as ColDef<TaxGridRow>[] };

    const rows: TaxGridRow[] = data.rows.map((r) => ({
      key: r.kind === "form" ? `form:${r.key}` : r.key,
      isForm: r.kind === "form",
      lineNumber: r.lineNumber,
      label: r.kind === "form" ? `Form ${r.label.replaceAll("_", " ")}` : r.label,
      registryOnly: r.registryOnly,
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

    const cols: ColDef<TaxGridRow>[] = [
      {
        colId: "line",
        headerName: "Line",
        pinned: "left",
        width: 64,
        valueGetter: (p) => p.data?.lineNumber ?? "",
        cellClass: "text-muted-foreground font-mono",
      },
      {
        field: "label",
        headerName: "",
        pinned: "left",
        width: 280,
        cellRenderer: (p: { data?: TaxGridRow; value?: string }) => {
          const d = p.data;
          if (!d) return p.value;
          return (
            <span
              className={
                d.isForm
                  ? "inline-flex items-center gap-1.5 font-semibold"
                  : "inline-flex items-center gap-1.5"
              }
            >
              {p.value ?? ""}
              {d.registryOnly ? (
                <span
                  title="On the tax form only - no statement placement"
                  className="rounded bg-muted px-1 text-[10px] text-muted-foreground"
                >
                  tax-only
                </span>
              ) : null}
            </span>
          );
        },
      },
      ...data.periods.map((p): ColDef<TaxGridRow> => {
        // Sized to the longest rendered value - currency never clips (M13.2).
        const maxChars = rows.reduce((m, r) => {
          const c = r.cells[p];
          return c ? Math.max(m, c.display.length + (c.verified ? 5 : 0)) : m;
        }, p.length);
        return {
          colId: p,
          headerName: p,
          width: moneyColumnWidth(maxChars),
          type: "rightAligned",
          valueGetter: (params) => {
            const cell = params.data?.cells[p];
            if (!cell) return "";
            return cell.verified ? `${cell.display} ✓IRS` : cell.display;
          },
          cellClass: (params) => {
            const cell = params.data?.cells[p];
            if (cell?.status === "suggested") return "text-severity-warning font-mono tabular-nums";
            return "font-mono tabular-nums";
          },
          tooltipValueGetter: (params) => {
            const cell = params.data?.cells[p];
            if (!cell) return "";
            const base = `${cell.status} · confidence ${cell.confidence ?? "-"}`;
            return cell.verified ? `${base} · verified by IRS transcript` : base;
          },
        };
      }),
    ];
    return { rowData: rows, columnDefs: cols };
  }, [spread.data]);

  if (spread.isLoading) {
    return (
      <div className="flex h-full items-center justify-center" data-slot="page-skeleton">
        <GridLoader label="Loading spread…" />
      </div>
    );
  }
  if (spread.error) {
    return <p className="p-4 text-sm text-severity-critical">{spread.error.message}</p>;
  }
  if (rowData.length === 0) {
    return (
      <div className="glass-card flex h-full items-center justify-center rounded-xl text-sm text-muted-foreground">
        No tax-form facts yet - upload a return and run the pipeline.
      </div>
    );
  }

  return (
    <div className="credexis-grid h-full w-full">
      <AgGridReact<TaxGridRow>
        rowData={rowData}
        columnDefs={columnDefs}
        getRowId={(p) => p.data.key}
        overlayNoRowsTemplate={`<span style="color: var(--muted-foreground); font-size: 13px;">No tax-form facts yet - upload a return and run the pipeline.</span>`}
        theme={credexisGridTheme}
        headerHeight={GRID_HEADER_HEIGHT}
        rowHeight={GRID_ROW_HEIGHT}
        tooltipShowDelay={300}
        onCellClicked={(e) => {
          const d = e.data;
          if (!d || d.isForm) return;
          const cell = e.colDef.colId ? d.cells[e.colDef.colId] : undefined;
          if (cell?.factId && e.colDef.colId) {
            onSelectCell?.({ factId: cell.factId, nodeKey: d.key, periodLabel: e.colDef.colId });
          }
        }}
      />
    </div>
  );
}
