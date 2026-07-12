/**
 * Layout → statement grid (M5.1, Blueprint §4.3 step 1).
 *
 * Converts the vendor adapter's LayoutTable (cells with text + bbox +
 * row/col identity) into the statement model the later stages type, bind,
 * and map. ZERO hand-rolled geometry (post-mortem traps 1/6/7): every
 * value keeps the vendor's (row, col) identity and bbox — nothing is ever
 * assigned by ordinal position in a list, so a blank middle cell cannot
 * shift its neighbors (regression-tested).
 */

import type { Bbox, LayoutPage, LayoutTable } from "../types.js";

export interface GridCell {
  text: string;
  bbox: Bbox;
}

export interface GridRow {
  rowIndex: number;
  /** Leftmost cell's text — the line-item label ("Rent", "Total Expenses"). */
  label: string;
  /** Label indentation: the label cell's x origin (row-typing cue, M5.2). */
  labelX: number | null;
  /** Value cells keyed by COLUMN IDENTITY — never by position in an array. */
  cells: Map<number, GridCell>;
}

export interface StatementGrid {
  page: number;
  bbox: Bbox;
  /** Column ids present anywhere in the table, ascending. */
  columnIds: number[];
  rows: GridRow[];
}

/**
 * One table → one grid. The vendor's colIndex IS the column identity;
 * column 0 is treated as the label column, everything else as value
 * columns. Multi-cell labels (rare vendor split) concatenate in x-order.
 */
export function toStatementGrid(table: LayoutTable): StatementGrid {
  const rowsByIndex = new Map<number, GridRow>();
  const columnIds = new Set<number>();

  for (const cell of table.cells) {
    let row = rowsByIndex.get(cell.rowIndex);
    if (!row) {
      row = { rowIndex: cell.rowIndex, label: "", labelX: null, cells: new Map() };
      rowsByIndex.set(cell.rowIndex, row);
    }
    if (cell.colIndex === 0) {
      row.label = row.label === "" ? cell.text.trim() : `${row.label} ${cell.text.trim()}`.trim();
      row.labelX = row.labelX === null ? cell.bbox.x : Math.min(row.labelX, cell.bbox.x);
    } else {
      columnIds.add(cell.colIndex);
      // Column identity binding: the cell lands at ITS colIndex, full stop.
      row.cells.set(cell.colIndex, { text: cell.text, bbox: cell.bbox });
    }
  }

  return {
    page: table.page,
    bbox: table.bbox,
    columnIds: [...columnIds].sort((a, b) => a - b),
    rows: [...rowsByIndex.values()].sort((a, b) => a.rowIndex - b.rowIndex),
  };
}

/** All grids on all pages, document order (statements are per-table). */
export function pagesToGrids(pages: LayoutPage[]): StatementGrid[] {
  return pages
    .slice()
    .sort((a, b) => a.page - b.page)
    .flatMap((p) => p.tables.map(toStatementGrid));
}
