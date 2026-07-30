# 02 — Vercel Derivation (the reference is now measured, not remembered)

**Status:** binding for all UI work from 2026-07-30.
**Source:** 35 screenshots in `docs/Vercel-ui/` (desktop @2x 1512pt, mobile @2x ~375pt,
4 full-page captures), supplied by Pratik with the directive: _"Match it 100% the
same. just our colors."_ That directive supersedes the earlier "qualities, not
pixels" instruction and amends `00-DESIGN-LANGUAGE.md` where they conflict (§1).
The screenshots are reference material and stay **untracked** (gitignored) — we ship
our own implementation, never their assets or copy.

Numbers below were measured off the captures (2x px halved to pt, rounded to the
4pt grid). Where Vercel uses blue, **Credexis uses emerald**. Everything else is
matched.

---

## 1. Amendments to 00-DESIGN-LANGUAGE.md (same-PR rule, Iron Law #10)

1. **Primary buttons are flat white (dark mode) / flat near-black (light mode)** —
   Vercel's signature inverse button. The 135° emerald gradient is RETIRED
   everywhere. Emerald moves to the accent role (§2 Color).
2. **Accent mapping:** every place Vercel uses blue — toggles-on, checkboxes,
   progress rings, active checklist rows, links, Beta pills, focus rings — we use
   emerald. Semantic orange (warn) and red (danger) match Vercel's usage.
3. **Type scale retuned** to measured values: 28/20/16/14/13/11 (§3). The old
   24/18/15/13/11 scale is superseded; `text-[15px]` remains valid inside rows.
4. **Mobile navigation:** the bottom tab bar is RETIRED. Mobile nav = floating
   `Find | ≡` pill (bottom-center) opening a full nav sheet, exactly as the
   captures show. Overflow "..." menus on mobile render as bottom sheets.
5. **The bell moves into the sidebar identity row** (desktop); the top bar right
   side belongs to page-scoped actions only.

## 2. Tokens (globals.css `@theme` additions)

**Surfaces (dark):** canvas `#0a0a0a` (near-black; kill the gradient mesh on app
routes — it survives only on auth screens); `surface-1` card `#111112` w/ border
`rgba(255,255,255,.08)`; `surface-2` popover/menu `#161617` w/ same hairline +
`shadow-lg`; zebra row overlay `rgba(255,255,255,.04)`; hover row
`rgba(255,255,255,.06)`. Light mode mirrors with black hairlines (6%) on `#fafafa`
canvas / `#fff` cards.

**Radii:** input/button/select/kbd **8px**; card/popover/menu **12px**; modal
**16px**; sheet **20px**; pill/badge full. (Supersedes 10/14/20.)

**Type (Geist):**
| token | size/weight | use |
|---|---|---|
| `text-display` | 28/600 | page h1 ("Environment Variables", "Members") |
| `text-title` | 20/600 | settings-card titles |
| `text-heading` | 16/600 | section headers ("Usage", "Projects"), widget titles, empty-state titles |
| `text-body` | 14/400 | descriptions, inputs, nav rows (15 inside dense list rows is fine) |
| `text-meta` | 13/400 | secondary row lines, table headers, footer hints |
| `text-label` | 11/500 uppercase tracking-wide | sidebar section labels ("COMPUTE"), column labels |
Money/metrics: tabular-nums medium+, never muted, never mono. Mono strictly for
identifiers (branch names, hashes, env-var names, IDs) at 13.

**Buttons:** primary = white bg/black text (dark), hover `#ededed`; secondary =
`surface-1` + hairline; ghost = text-only hover-surface; danger = `#dc2626` filled;
sizes h-8 (toolbar), h-9 (default), h-10 (marketing/modals only). Icon buttons are
square, hairline, radius-8. Split buttons (Visit ▾ pattern) share one hairline.

**Controls:** Switch 36×20 pill, thumb white, on = emerald fill. Checkbox 16px
radius-4, checked = emerald fill + white check, dash for partial. Segmented
(filled-cell): container `surface-1` hairline radius-8 p-0.5, active cell filled
`rgba(255,255,255,.1)`. Underline tabs: 15/500, active white + 2px underline,
container bottom hairline. Inputs h-9 radius-8 `surface-1` hairline, focus ring
2px emerald at 40%; search inputs get leading magnifier + optional trailing kbd
chip (bordered 20×20 radius-6, 12px).

**Pills:** hairline bordered, h-6, radius-full, 12px/500: neutral grey; warn =
orange text/border on orange-950 tint ("Needs Attention"); accent = emerald
("Beta"); mono-content pills for identifiers with 6px status dot.

**Status:** green dot = Ready/live; progress ring (emerald) with check when
complete; orange sidebar count badge (radius-full, 11px tabular).

**Motion:** unchanged (150ms ease-out state / 250ms surface-enter), plus sheet
slide-up 250ms and skeleton pulse ~1.6s.

## 3. Component inventory (build once, reuse everywhere)

1. **`AppSidebar`** — 250pt fixed; slots: scope header (switcher + plan pill +
   ⇅), `Find` input (kbd F), nav rows (36pt, icon 16, 14/500, active = filled row;
   optional right: chevron ›, count badge, Beta pill), section hairline splits,
   `text-label` group headers, bottom promo slot (dismissible card), **identity
   footer row**: avatar + name + "..." menu + bell w/ unread dot.
   **Contextual takeover:** scoped pages swap nav for `‹ {Context}` header + child
   rows (Settings sub-nav, future Logs filter rail). Back chevron returns.
2. **`AppTopBar`** — 56pt; left: scope selector (`All Deals ⇅` / `{deal} ⇅`);
   center: page title 15/500 or `Muted / Current` breadcrumb; right: page actions.
   Mobile: back chevron + centered title + one action.
3. **`MobileNavPill` + `NavSheet`** — floating pill bottom-center (`Find | ≡`),
   ≡ opens full-height nav sheet (entire sidebar content); Find focuses search.
   Replaces `tab-bar`. Overflow menus → `BottomSheet` (grab handle, 56pt rows).
4. **`PageHeader`** — `text-display` h1 + 14 muted desc (+ optional Learn-more
   link) left; primary/secondary actions right. ALL list pages use it.
5. **`SettingsCard`** — the workhorse: `surface-1`, radius-12; body p-6: title-20,
   desc-14 muted, then content (inputs/selects/toggles/anything); optional
   **footer strip** separated by hairline: 13 muted hint left (may contain links),
   action button right (h-8). `variant="danger"`: red hairline, footer tinted
   red-950, red filled button. Disabled-save = white button at 40%.
6. **`List` / `ListRow`** — one `surface-1` container; rows 48–64pt hairline-
   separated (optional zebra for mono data rows); leading icon/avatar slot; two-line
   center (15/500 + 13 muted); trailing cluster: pills, value (tabular), time,
   "..." menu. `ShowMoreRow` = fade-out gradient + centered pill button.
   `LoadMoreRow` = full-width footer row button.
7. **`WidgetCard`** — dashboard cards: 16/600 title + optional › drill; body =
   stat pairs (label-13 muted over value-16/600 tabular + delta pill green/red) +
   sparkline/chart area; or checklist rows (completed = accent-tinted fill,
   strikethrough, check — the Production Checklist look).
8. **`UsageMeterCard`** — "Last 30 days" header + Upgrade-slot; rows: progress
   ring 16 + label-14 + ⓘ + right `used / quota` tabular muted-slash; zebra;
   bottom-center expander chevron circle straddling the card edge.
9. **`EmptyState`** — centered: icon chip (40pt radius-10 `surface-2`), 16/600
   title, 14 muted one-liner, optional buttons (white primary + outline pair).
   Replaces every dashed box and the AG Grid default text.
10. **`Modal`** — radius-16, max-w ~560pt, centered 20/600 title, content,
    footer hairline: Cancel outline left, primary right. Scrim 70% + blur-sm.
11. **`Popover/Menu`** — `surface-2`, radius-12, shadow-lg; 13/500 label rows
    ("Filter by", "Sort by") + hairline sections; rows 40pt with leading icon or
    trailing check; destructive rows red. Account menu: header (name+email+gear),
    Theme row with inline 3-state segmented (system/light/dark), rows w/ trailing
    icons, full-width white CTA slot, **status footer row** (emerald dot +
    "All systems normal." → pipeline health link).
12. **`FilterBar`** — h-8 controls row: search-select dropdowns ("All deals ▾",
    "All users… ▾" with embedded search), date-range select, sort select (⇅ icon),
    icon-button + segmented view toggle (grid/list), primary "Add New ▾" at the
    right end.
13. **`ActivityFeed`** — month `text-heading` group headers; rows: avatar +
    sentence (muted verbs, **bold objects**, mono hashes) + right relative time;
    no row surfaces; sub-events nest under an icon header with a left thread rail.
14. **`Skeleton`** — static chrome renders instantly; every data slot mirrors its
    final anatomy (circle+line rows, card blocks, button blocks) with pulse.
    Never render fake zeros while loading (the current mobile workspace bug).
15. **`CopyField`** — mono value in bordered radius-8 box + copy icon button.
16. **`InfoCallout`** — hairline surface row: ⓘ + 13/1.5 text with inline links.
17. **`NoticeStrip`** — full-width surface row: icon + 14 text + right button
    (Vercel's upgrade strips; ours: envelope exceeded, chain-verify notices).
18. **`KbdChip`**, **`DeltaPill`** (+n% green / -n% red tinted), **`QRPanel`**
    (borrower link QR), **`MatrixTable`** (rows × Push/Email/Web checkbox columns,
    section header rows carry the column labels; horizontal scroll on mobile).

## 4. Route mapping (Credexis ⇄ reference capture)

| Credexis route                     | Reference                                                        | Treatment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/` deals home                     | 12.58.02 grid, 12.58.10 list, 12.58.29 filter menu               | Two-pane: left rail (Usage meter card w/ real envelope+limits, Alerts→notification empty card, Recent activity feed from audit) + right Projects-style deal grid; grid/list toggle; filter+sort menu; Add New ▾ (New deal / Invite borrower). Deal card = icon-chip, name 15/600, type muted, status ring top-right, last-event line + `repo · time`-style meta (`3/5 docs · 2h ago`), DSCR right-aligned tabular. List view = one surface, hairline rows. Kanban RETIRED on desktop (status lives in ring + filter); mobile keeps urgency-ordered single list w/ tabbed Recents/Usage card.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Deal scope (`/deals/[id]/*`)       | 1.00.26, 1.00.31, 1.14.46                                        | Scope selector shows the deal; sidebar = deal nav (Overview NEW, Workspace, Documents, Review, Assignment, Borrower, Audit). **Deal Overview page** (new route): hero card (spread thumbnail placeholder / status Ready dot / created-by / source: last upload; actions: GitHub-slot→"Open workspace" white + Export ▾ split + "..."), "Deal checklist n/5" widget (doc checklist, completed rows accent-filled strikethrough), "Extraction 6h ›" widget (runs/pages/failures from `extraction_runs` — real), "Validation ›" widget (open issues by gate — real), Active-branches-style list → recent documents rows.                                                                                                                                                                                                                                                                                                                                                                                  |
| `/deals/[id]/borrower`             | 1.14.46 QR panel                                                 | Invite rows get QR popover for the claim link + copy-field; keep invite form as SettingsCard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/settings` section                | 12.59.20/26/33/48, mgeneral, msecurity, mnotifs, 1.16.50–1.18.38 | Sidebar takeover `‹ Settings`: General, Members, Notifications, Security, Audit log, Plan & Usage, Activity. Every card = `SettingsCard`. General: org name (prefix-input style), org kind, Org ID CopyField, danger Leave/Delete (delete disabled + honest footer). Members: Invite card (email+role, "⊕ Add more"), underline tabs Members/Pending, FilterBar (role filter, MFA status, date sort), list rows w/ role + 2FA chip + "..." menu. Notifications: channels card (Web/Email rows + gear + toggle) + MatrixTable by category (Deals, Documents, Borrower portal, Review, Exports). Security: password change, sign-out-everywhere, MFA enroll/enforce (enforce = disabled toggle + InfoCallout until Tier-3), session ceiling note, **Export audit CSV card** (date range + Export button — real via audit.list), Retention card (selects, disabled, footer names D6 as pending). Plan & Usage: read-only plan card (feature grid w/ emerald checks) + usage meters; Invoices empty state. |
| `/settings/audit`                  | 1.18.22 Activity + existing table                                | Add feed presentation (month headers, bold-token sentences, thread rail for pipeline actors) with FilterBar (deal ▾, user ▾, event ▾, All Time ▾); table stays as a toggle for compliance export.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/costs` → absorbed into **Usage** | 1.00.15, 1.16.50                                                 | UsageMeterCard rows: extraction spend vs envelope per deal, pages processed, docs/deal vs 60, bytes vs 1 GiB (0021 limits — real), invites active. Per-deal drill table below. Nav row renamed "Usage".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **`/logs`** (new, org nav)         | 12.59.08                                                         | Extraction/pipeline run feed on `extraction_runs` (real): filter rail takeover (deal, stage, status, time), toolbar (search, Live ghost-button, refresh, export icons), table Time/Deal/Stage/Status/Pages, EmptyState with white "Refresh" + "Learn more". Live tail = later backend.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Auth screens                       | —                                                                | Keep split-brand layout; adopt button/input tokens; gradient mesh may stay here only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Workspace                          | (no analog)                                                      | Keeps cockpit chrome; adopts tokens: toolbar pills → Segmented, XLSX → Export ▾ split white button, empty grid/inspector → EmptyState, metrics strip → stat pairs, kill "M8.6" copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 5. New-feature map (UI-first; Pratik will order the backends later)

Ground rule per Iron Laws #1/#3: a surface may exist before its backend, but it
must never invent a number — data is real, or the state is honestly empty/disabled.

**Real data already behind them (wire now):** Deal Overview widgets
(`extraction_runs`, `issues`, doc checklist), Usage meters (0021 limits, costs
tables), audit feed + CSV export, borrower QR, notification channel toggle
(profile flag), status ring per deal, Find over loaded deals (client selection).

**UI now, backend later (may "break", per Pratik):** per-kind notification
matrix writes, org General writes (step 16 definer), MFA enforcement toggle,
retention selects (D6), Plan card contents beyond a static tier name (D1),
Logs live-tail, Alerts anomalies, deal Transfer/Delete menu rows (disabled with
honest hint), pipeline-health status footer, Find over documents/facts.

**Explicitly not cloned:** Agent, AI Gateway, Sandboxes, Workflows, CDN/world
map, Speed Insights, Firewall, Domains, Flags, Marketplace/Integrations (no
product analog); no invented sparkline anywhere a real series doesn't exist.

## 6. Execution order (small PRs, every one verified 375 + 1440 on a prod build)

- **PR-A `ui-17-derivation-docs`** — this doc; gitignore `docs/Vercel-ui/`;
  amendments in §1 stamped into 00-DESIGN-LANGUAGE.md.
- **PR-B `ui-17-tokens-controls`** — tokens; Button (white primary, split,
  danger), Input/Select/kbd, Switch, Checkbox, Pill, Segmented (both styles),
  focus rings; e2e names untouched. Copy fixes ride along (M8.6 line, org_owner,
  loading zeros, emoji, AG Grid empty text, account-menu Settings item).
- **PR-C `ui-17-shell`** — AppSidebar (+identity footer, Find, sections,
  takeover machinery), AppTopBar (scope selector, centered title), MobileNavPill
  - NavSheet (tab bar deleted), AccountMenu v2, notifications popover restyle.
- **PR-D `ui-17-deals-home`** — PageHeader, FilterBar, grid/list toggle, deal
  cards + list rows, left rail widgets, first-run, skeletons; kanban retired.
- **PR-E `ui-17-settings`** — settings takeover + General/Members/Notifications/
  Security/Audit/Plan per §4; `card.tsx` deleted; `/org/members` moved (redirect);
  matrix + security + audit-export cards. Closes plan-01 step 11.
- **PR-F `ui-17-deal-scope`** — deal sidebar nav, Deal Overview page, documents
  rows, borrower QR, review/assignment restyle, workspace token pass.
- **PR-G `ui-17-logs-usage`** — /logs on extraction_runs, /costs→Usage, audit
  feed presentation.
- **PR-H `ui-17-sweep`** — every route × 375/768/1024/1440 screenshot matrix,
  skeleton coverage, dead styles deleted, `prod-smoke` fallback detector
  retargeted with the loader swap (plan-01 §3.2 stays honored).

e2e contracts from plan-01 §3.2 are preserved byte-for-byte in every PR; the
X4 `FieldSelect` names survive the members move; `prod-smoke.spec.ts:121` stays
valid because `/login` keeps its own toggle.
