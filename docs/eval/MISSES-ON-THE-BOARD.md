# Named extraction misses - the live bake-off board

Each entry is a future TDD fixture. Updated by the M23 autopsy loop
(`node packages/eval/dist/autopsy.js` after a live bake-off).

## 2026-08-13 (after M23 fixes)

Named misses the live bake-off exposes after the M23 fixes. Each is a
future TDD fixture, not a guess:

- `1040-2024-native-002` **line 22** (tax after credits, 8,667.00, p6):
  both paths returned blank while line 24 (same value) was found. Needs
  a look at the 1040 field prompt / Reducto schema for line 22.
- `pnl-annual-scanned-001` **Net Income** row not extracted on the
  scanned QBO P&L (bottom line missing on a scan; the monthly QBO P&Ls
  get it). Row typing / grid on the CCITT scan.
- `pnl-halfyear-native-001` **Rent** missed; `bs-monthly-native-001`
  **Total Liabilities and Equity** missed (bs-asof's now maps - check
  the monthly's exact printed spelling).
- `4562` line 1 and `bs.assets.other.total` are NULL-GT: blank boxes,
  measurement artifacts, not extraction problems.
