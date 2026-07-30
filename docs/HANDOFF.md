# Handoff - state of play, 2026-07-30 (post feedback pass 4)

Written so a fresh session (or a fresh person) can pick up without reading a
day of chat. Keep it short and current; delete anything that stops being true.

## Where the product actually is

The Vercel-derived redesign SHIPPED and has absorbed four rounds of Pratik's
feedback: PRs #151-#156, #158-#170, #172-#174 are on main (#171 was replaced
by #173 after the stacked-base auto-close trap), every one CI-green
(5 required checks; the "Vercel" check is a deploy status, not required -
it rate-limits on Hobby at ~10 deploys/day). The binding design spec is
`docs/design/ui-overhaul/02-VERCEL-DERIVATION.md`; Pratik's directive was
"match 100%, just our colors" measured from 35 captures (gitignored in
`docs/Vercel-ui/`, reference only).

What exists now, all production-verified: token system (near-black canvas,
hairlines, flat inverse primaries, emerald-as-accent, brand-teal CTAs);
sidebar shell with Find palette (F), contextual takeovers, identity footer;
deals home with grid/list toggle, filter/sort menu, usage + activity rail,
pin/unpin (localStorage), per-card menus (delete staged); the New-deal flow
is an IN-PAGE three-step wizard (board animates out, steps slide with
Next/Back, review before create) - the dialog is gone; Deal Overview page;
settings section (General, Notifications matrix, Security); top-level
Members, Audit log, Usage (charts + plan), Logs, Support (cases list +
"Get help with Credexis" agent-chat stub, honest handoff to
support@credexis.co); /notifications with real archive, max-w-5xl, and
illustrated empty states.

## Standing copy rule

NO EM DASHES anywhere in product copy - plain hyphens (Pratik, twice).
#170 swept every U+2014/U+2013 out of apps/web, apps/portal,
packages/pipeline, and the e2e specs. Do not reintroduce them.

## THE lesson of 2026-07-30 - do not relearn it

**Never add a route-segment `loading.tsx` in this app.** Any such Suspense
boundary above the client pages wedges react-query/uSES updates under
Next 15.5 production streaming: hooks stay `isLoading` forever while the
network returns 200s and React stays interactive. Fixed in #162 by deleting
every route boundary; loading states live INSIDE pages (Skeleton components;
the nine-dot `GridLoader` is the brand moment for the workspace spread grids
only). `prod-smoke`'s `expectNoStuckFallback` guards BOTH vocabularies
(`[data-slot=page-skeleton]` and `.grid-loader`).

Other traps that cost time, still true:

- Verify on ONE clean tab against `web-prod` (pinned to port **3100**).
  Before any rebuild: stop the server AND `lsof -ti :3100 | xargs kill` -
  zombie next-servers survive preview_stop and serve a corrupted .next
  (all-routes 500). Never rebuild while a server runs.
- A Bash `cd` persists for later calls - git pathspecs are cwd-relative;
  Pratik's private `docs/instructions/` PDFs got committed twice that way
  (both scrubbed; verify with `git cat-file -e HEAD:<path>`).
- Merging a stacked PR's base branch auto-closes the child PR and a closed
  PR cannot be retargeted or reopened once its base ref is deleted. Order:
  merge parent WITHOUT deleting its branch, retarget the child to main,
  THEN delete the branch. (#157→#158 and #171→#173 both paid this tax.)
- `gh pr checks --watch --fail-fast` trips on the non-required Vercel check;
  gate merges on `mergeStateStatus` ∈ {CLEAN, UNSTABLE} instead.
- The M10.3 mutation-tier test requires every new mutation to be
  underwriter+ or an explicit self-scoped exception WITH rationale.

## Portal reachability - VERIFIED

The web app reads `apps/web/.env.local` (NOT the repo-root `.env.local`);
`NEXT_PUBLIC_PORTAL_URL=https://credexis-portal.vercel.app` lives there now,
and Pratik set it in Vercel (web + portal projects) and Trigger. Local
verification: an invite minted on the borrower page produces
`https://credexis-portal.vercel.app/claim?token=...` and the live portal
serves the claim flow (token moves off the URL via 307). Production note:
Vercel env changes only take effect on the NEXT deploy of credexis-web -
if invite links on production still show localhost, redeploy.

## What is NOT done (in order)

1. **Interaction audit** (Pratik's item c): finish the 375→1440 sweep
   (remaining: review, assignment, borrower, workspace pages) and click
   every control - no dead ends.
2. **Pratik's end-to-end deal run** - blocked on his Anthropic API top-up
   (extraction fails on credits, see memory).
3. **Staged UI awaiting backends** (all labeled "Soon"/disabled - Pratik
   orders them explicitly): delete deal, bulk member actions, org-settings
   writes, notification matrix writes, TOTP, retention, Logs live-tail,
   support agent wiring + case backend (cases are localStorage today),
   "New integration".
4. Known debt: `deals.board` unpaginated (fine at pilot scale); middleware's
   signed-in `/login` redirect drops `?next=` (memory:
   middleware-login-next-param); CI minutes burn fast at this PR cadence.

## Scratch data

Tenant "Meridian Bank SBA" / ui-audit@credexis.test (deterministic c0ffee
IDs) exists in the LIVE db for UI verification - now includes a
"Wizard Smoke Test" deal and a Ravi Shah borrower invite from verification.
Cleanup: `node seed-ui-audit.mjs --clean` (script in the session scratchpad;
recreate from the live-e2e helpers if lost). Delete before real-customer
data lands.
