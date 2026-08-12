# Handoff - state of play, 2026-08-11 (post M15 pro-forma)

Written so a fresh session (or a fresh person) can pick up without reading
weeks of chat. Keep it short and current; delete anything that stops being
true.

## Where the product actually is

Documents in → pro-forma out WORKS END TO END on a real deal. Golden Deal 1
(Travelodge Merrill acquisition - target + 2 guarantors + 3 operating
companies, 29 documents, ~480 pages) ran through the deployed pipeline:
1,025 facts across 6 entities, deal auto-advanced to Review, and the
Pro-Forma tab projects three years off the accepted base with debt service
amortized from a real SBA scenario (DSCR rendered per year). The pro-forma
engine's acceptance test reproduces the deal's REAL banker workbook
(JadeRock) to the cent.

Shipped milestones on top of the Vercel-derived UI (#151-#176):

- M13: classifier structural guards (citations never identities; unknown
  forms → null; NON_FORM/4626 families); scanned PDFs render to images for
  the vision classifier (#186/#187 - identity-bound, batch-isolated,
  unreadable = failed, never silent).
- M14: golden-deal fixes - debt schedules outrank referenced balance
  sheets (#188), garbled ToUnicode text routes to vision (#189), duplicate
  learned mappings can't fail statements (#191 + migration 0035), business
  returns extract back to TY2020 with year-scoped G4 gate specs (#192 -
  the 1065's 2023 numbering was wrong in base data and is now verified
  against printed forms).
- M14.5: extraction FOLLOWS entity assignment (#194 carried it; #193
  auto-closed empty) - the extract-document task, per-span, idempotent.
  Before this, multi-entity deals could never extract.
- M15: pro-forma engine (#195, fixes #196) - pure projection module in
  packages/engine/src/proforma (%-of-revenue / fixed / excluded
  treatments, linear annualization, compounding growth, amortized debt
  service, DSCR); proforma tRPC router computes on read from ACCEPTED
  target-entity facts; assumptions persist in proforma_assumptions
  (migration 0036, RLS + audit, applied to prod); workspace Pro-Forma tab.

## Deploy state

Trigger worker: local-build recipe from packages/pipeline -
`DOCKER_CONFIG=/tmp/docker-config-clean npx trigger.dev@4.5.4 deploy
--local-build` (Docker Desktop must run; @napi-rs/canvas is build.external
so the Linux container installs its own binary). 5 tasks. Deploys only
work from Pratik's Mac - move to CI eventually.

## Traps that cost time (all still true)

- NEVER a route-segment loading.tsx (react-query wedges under Next 15.5
  streaming). Loading lives in-page.
- Rebuild ritual: stop server AND `lsof -ti :3100 | xargs kill`, then
  rm -rf apps/web/.next, then build. Never build while a server runs.
- Stacked-PR order: merge parent WITHOUT deleting its branch, retarget
  child, THEN delete. And never cut a new branch while sitting on an
  un-merged feature branch - #194's squash silently carried #193's work
  (fine, but the history reads wrong).
- gh merge gating: mergeStateStatus ∈ {CLEAN, UNSTABLE}; the Vercel check
  is non-required and rate-limits on Hobby.
- pnpm audit runs in Quality gates on every PR - new upstream highs fail
  unrelated PRs; clear via root pnpm.overrides (pattern in #190/#194).
- supabase-js RETURNS errors; `.maybeSingle()` throws on >1 row; Postgres
  UNIQUE treats NULLs as distinct (migration 0035's lesson).
- The assignment UI stages DRAFTS - the row's Save button commits. An
  automated sweep (or a hurried human) that only picks from the dropdown
  commits NOTHING. Bulk-assign UX improvement is queued.
- NO EM DASHES in product copy - plain hyphens (standing rule).

## What is NOT done (in order)

1. **Excel export matching the bank's template** (Pratik's next directive)
   - exceljs exists in the stack; the JadeRock workbook is the reference.
2. Golden-corpus labeling of Golden Deal 1 → a QUOTABLE accuracy number
   (Iron Law #9: public/synthetic docs never count).
3. Bulk assignment UX (Save-all / commit-on-select with undo).
4. Staged "Soon" backends (delete deal, TOTP, retention, live-tail, support
   backend, integrations) - Pratik orders explicitly.
5. Known debt: deals.board unpaginated; middleware /login drops ?next=;
   1040 line coverage is thinner than business returns; K-1 extraction is
   minimal (2-15 facts/doc); statement facts are always suggested (by
   design until mapping review UX exists).

## Live data notes

Tenant "Meridian Bank SBA" / ui-audit@credexis.test holds the REAL Golden
Deal 1 documents (uploaded 2026-08-11, deal 76cbe240-…) plus older scratch
deals. This is real client PII from a partner bank's closed deal - do not
share screenshots outside the team, and delete the tenant before any
external demo env ships. The staged upload set (renamed, collision-free)
lives at ~/Downloads/golden-deal/demo-upload for re-runs.

Marketing screenshots come from the SYNTHETIC source-demo fixture instead
(apps/web/e2e/source-demo.live.spec.ts): it seeds "Workspace Opco LLC"
with a generated fake 1120-S whose facts carry real source_page/bbox
lineage, verifies click-to-source, and saves
apps/web/e2e/screenshots/source-viewer-hero.png. Run with
`RUN_LIVE_E2E=1 SOURCE_DEMO_KEEP=1 pnpm --filter @credexis/web test:e2e
e2e/source-demo.live.spec.ts` to keep the deal up (credentials printed)
for manual capture; add E2E_TARGET_URL to shoot the deployed UI (the dev
server draws the Next.js dev badge into screenshots).
