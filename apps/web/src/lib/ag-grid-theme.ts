/**
 * Shared AG Grid v36 theme (ui-3): the V1 grid density and chrome,
 * expressed through the Theming API instead of V1's .ag-theme-alpine CSS
 * overrides (legacy CSS imports conflict with v36's generated styles).
 *
 * Every color is a var() reference into the design tokens, so dark mode
 * flips with the `.dark` class for free — no JS wiring. If derived-shade
 * mixing ever misbehaves, the fallback is per-mode withParams(params,
 * "light"|"dark") + data-ag-theme-mode synced in the theme toggle.
 */

import { themeQuartz } from "ag-grid-community";

export const credexisGridTheme = themeQuartz.withParams({
  accentColor: "var(--primary)",
  backgroundColor: "var(--card)",
  foregroundColor: "var(--foreground)",
  borderColor: "var(--border)",
  headerBackgroundColor: "var(--muted)",
  headerTextColor: "var(--muted-foreground)",
  rowHoverColor: "color-mix(in oklab, var(--accent) 60%, transparent)",
  selectedRowBackgroundColor: "color-mix(in oklab, var(--primary) 10%, transparent)",
  fontFamily: "inherit",
  fontSize: 13,
  headerFontWeight: 600,
  wrapperBorderRadius: 12,
  cellHorizontalPadding: 14,
  rowBorder: { color: "var(--border)" },
});

/** V1 grid density (ProFormaGrid.tsx): 38px rows under a 42px header. */
export const GRID_ROW_HEIGHT = 38;
export const GRID_HEADER_HEIGHT = 42;
