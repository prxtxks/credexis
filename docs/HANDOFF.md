# Handoff — state of play, 2026-07-30 (post ui-17/ui-18)

Written so a fresh session (or a fresh person) can pick up without reading a
day of chat. Keep it short and current; delete anything that stops being true.

## Where the product actually is

The Vercel-derived redesign SHIPPED: PRs #151–#156, #158–#166 are on main,
every one CI-green (5 required checks; the "Vercel" check is a deploy status,
not required — it rate-limits on Hobby at ~10 deploys/day). The binding design
spec is `docs/design/ui-overhaul/02-VERCEL-DERIVATION.md`; Pratik's directive
was "match 100%, just our colors" measured from 35 captures (gitignored in
`docs/Vercel-ui/`, reference only).

What exists now, all production-verified: token system (near-black canvas,
hairlines, flat inverse primaries, emerald-as-accent, brand-teal CTAs);
sidebar shell with Find palette (F), contextual takeovers (settings sub-nav,
deal rail), identity footer; mobile Find/menu pill (tab bar is gone); deals
home with grid/list toggle, filter/sort menu, usage + activity rail,
pin/unpin (localStorage), per-card menus (delete staged); Deal Overview page
(state hero, checklist widget, extraction/validation widgets); settings
section (General, Members in the reference layout, Notifications matrix,
Security incl. real password change / sign-out-everywhere / audit CSV export,
Audit log, Plan & Usage); /notifications page with REAL archive (the existing
`dismissed` state; `list` gained a view param, `archiveAll` added +
tier-test exception); /support with the agent-chat stub (honest handoff to
support@credexis.co); /logs on `extraction_runs` (`pipeline.runs`); Costs →
Usage rename; redesigned New-deal modal (radio-card types, entity rows,
checklist chips).

## THE lesson of 2026-07-30 — do not relearn it

**Never add a route-segment `loading.tsx` in this app.** Any such Suspense
boundary above the client pages wedges react-query/uSES updates under
Next 15.5 production streaming: hooks stay `isLoading` forever while the
network returns 200s and React stays interactive. It reproduced
deterministically and burned hours twice (first misdiagnosed as preview-tab
cookie races — wrong). Fixed in #162 by deleting every route boundary;
loading states live INSIDE pages (Skeleton components; the nine-dot
`GridLoader` is the brand moment for the workspace spread grids only).
`prod-smoke`'s `expectNoStuckFallback` guards BOTH vocabularies
(`[data-slot=page-skeleton]` and `.grid-loader`).

Other traps that cost time today, still true:

- Verify on ONE clean tab against `web-prod` (pinned to port **3100**;
  never `rm -rf .next` or rebuild while a server is running).
- A Bash `cd` persists for later calls — git pathspecs are cwd-relative;
  Pratik's private `docs/instructions/` PDFs got committed twice that way
  (both scrubbed; verify with `git cat-file -e HEAD:<path>`).
- `gh pr checks --watch --fail-fast` trips on the non-required Vercel check;
  gate merges on `mergeStateStatus` ∈ {CLEAN, UNSTABLE} instead.
- The M10.3 mutation-tier test requires every new mutation to be
  underwriter+ or an explicit self-scoped exception — it caught `archiveAll`
  correctly; add exceptions WITH rationale.

## What is NOT done (in order)

1. **Audit feed presentation** (02 §4): month-grouped sentence feed over the
   existing audit table; then the 375→1440 screenshot sweep (02 PR-H).
2. **Staged UI awaiting backends** (all labeled "Soon"/disabled in the UI —
   Pratik will order them explicitly): delete deal, bulk member actions,
   org-settings writes (plan-01 step 16), per-category notification matrix
   writes (step 18), TOTP enroll/enforce (step 13), retention (D6), Logs
   live-tail, support agent chat wiring, "New integration".
3. **Pratik's sequence after UI:** (a) portal reachability —
   `NEXT_PUBLIC_PORTAL_URL` must be set in Vercel AND Trigger before anyone
   tests borrower links; (b) his end-to-end deal run (top up the Anthropic
   API balance first — extraction fails on credits, see memory); (c) full
   interaction audit (every control clickable and sensible, no dead ends).
4. Known debt: `deals.board` unpaginated (fine at pilot scale); middleware's
   signed-in `/login` redirect drops `?next=` (memory:
   middleware-login-next-param); CI minutes burn fast at this PR cadence.

## Scratch data

Tenant "Meridian Bank SBA" / ui-audit@credexis.test (deterministic c0ffee
IDs, 8 deals) exists in the LIVE db for UI verification. Cleanup:
`node seed-ui-audit.mjs --clean` (script in the session scratchpad; recreate
from the live-e2e helpers if lost). Delete before real-customer data lands.
