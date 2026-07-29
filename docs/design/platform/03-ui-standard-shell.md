# Credexis UI Standard & App Shell v2 — Design Document (Brief C)

Status: proposed · Scope: apps/web only (presentation + shell; zero engine/pipeline changes) · Companion: `docs/ARCHITECTURE.md` §8, `CLAUDE.md` iron laws 3, 7, 10

---

## 0. Current state (measured, not assumed)

| Area                                                | Fact                                                                                                                                                                                                                                | File                                                                                                                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens                                              | Full V1 emerald/teal oklch token system, `--radius: 0.625rem` (10px), `.gradient-btn`, `.glass-card`, `.frosted-toolbar`, `.shimmer`, sidebar token family (`--sidebar-*`) already defined but unused                               | `apps/web/src/app/globals.css:86-186, 406-425`                                                                                                                                                       |
| Fonts                                               | Geist Sans + Geist Mono wired as `--font-sans`/`--font-mono`                                                                                                                                                                        | `apps/web/src/app/layout.tsx:3-4,22`                                                                                                                                                                 |
| Vendored shadcn (new-york, `radix-ui` umbrella pkg) | badge, button, card, dialog, dropdown-menu, input, label, select, separator, sonner, table                                                                                                                                          | `apps/web/src/components/ui/*`                                                                                                                                                                       |
| Button                                              | Base is `rounded-md`, default variant is flat `bg-primary`; every brand CTA re-applies `gradient-btn rounded-full border-0` per call site                                                                                           | `components/ui/button.tsx:8,12`; call sites e.g. `app/page.tsx:132,207`, `login/page.tsx:166`, `documents/page.tsx:281`, `assignment/page.tsx:213`                                                   |
| Chrome                                              | Two parallel per-page headers: `AppHeader` (max-w-7xl centered, logo + breadcrumb + sign-out) and `WorkspaceToolbar` (frosted, back arrow + logo + panel pills)                                                                     | `components/app-header.tsx`, `components/workspace/workspace-toolbar.tsx`                                                                                                                            |
| Loading                                             | One pattern everywhere: full-area 9-dot `grid-loader` (spinner-class), no skeletons                                                                                                                                                 | `app/loading.tsx`, `deals/[dealId]/loading.tsx`, `documents/page.tsx:202-215`, `review/page.tsx:127-147`, `assignment/page.tsx:118-131`, `costs/page.tsx:38-51`, `workspace/spread-grid.tsx:243-258` |
| Motion                                              | framer-motion staggers (dashboard, login), infinite `animate-float` blobs on login; **zero `prefers-reduced-motion` handling anywhere** (grep confirms)                                                                             | `app/page.tsx:173-196`, `login/page.tsx:61-65`                                                                                                                                                       |
| Grid density                                        | AG Grid Quartz themed via tokens, 13px font, 38px rows / 42px header, mono tabular numerics in cells                                                                                                                                | `lib/ag-grid-theme.ts:14-33`                                                                                                                                                                         |
| Off-system controls                                 | Raw native `<select>/<input>/<button>` in SourceViewer, dashboard wizard, assignment (assignment's is deliberate — test flakiness note)                                                                                             | `workspace/source-viewer.tsx:171-223`, `app/page.tsx:64-107`, `assignment/page.tsx:9-12,159-197`                                                                                                     |
| Auth/data                                           | `profiles(id, tenant_id, email, full_name, role)` single-tenant per user; `current_tenant_id()` / `current_user_role()` SECURITY DEFINER helpers; deny-by-default RLS; append-only `audit_log` written by SECURITY DEFINER triggers | `packages/schema/drizzle/0000_schema-v1.sql:20-33`, `0001_rls-v1.sql:18-37`, `0004_audit-writer.sql:1-9`                                                                                             |
| tRPC                                                | 13 routers: health, me, documents, review, assignment, addbacks, metrics, deals, spread, source, issues, policy, pipeline, transcripts                                                                                              | `src/server/trpc/router.ts`                                                                                                                                                                          |
| Deps                                                | `radix-ui@1.4.3` umbrella (all primitives available), framer-motion, lucide, sonner. **No `cmdk`**                                                                                                                                  | `apps/web/package.json`                                                                                                                                                                              |

---

## 1. Design tokens — brand mapping (no new tokens needed, two additions)

The token system already matches www.credexis.co. The standard is: **components consume tokens; pages never restate geometry or color.**

- **Radius law:** every interactive control is `rounded-lg` (= `--radius`, 10px). `rounded-full` is reserved for Badge/status chips/avatar only. The current pill CTAs migrate via the Button component (§2.1), never per page.
- **Type law:** body 16px Geist Sans; headings `font-bold tracking-tight` (≈ −0.02em, Tailwind's `tracking-tight` is −0.025em — acceptable); all numerics `font-mono text-[13px] tabular-nums` (matches AG Grid's 13px).
- **Motion law:** 150–250ms `ease-out` for micro-interactions, 300ms max for panels; everything gated by reduced motion (§3).
- **Two globals.css additions** (same PR as Button v2):

```css
/* Brand on-dark button (login brand panel, marketing parity) */
.gradient-btn-on-dark {
  background: white;
  color: oklch(0.25 0.08 162);
  transition: all 0.2s ease;
}
/* Motion restraint — kills decorative animation for users who ask */
@media (prefers-reduced-motion: reduce) {
  .animate-float,
  .animate-shimmer,
  .shimmer,
  .grid-loader span,
  .animate-glow-pulse,
  .animate-gradient-x,
  .animate-border-spin {
    animation: none !important;
  }
  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
  }
}
```

(framer-motion consumers additionally wrap in `useReducedMotion()` — dashboard `app/page.tsx`, login.)

---

## 2. Component standards

### 2.1 Button — the one migration that fixes every CTA

Replace variants/sizes in `components/ui/button.tsx` (call sites then **delete** their `gradient-btn rounded-full border-0` overrides — that is the whole page migration for most CTAs):

```tsx
const buttonVariants = cva(
  // base: brand geometry — rounded-lg (10px = --radius), gap-2, semibold, 200ms
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        /** PRIMARY = brand emerald 135° gradient, white text (tokens in globals.css) */
        primary: "gradient-btn border-0 text-white",
        /** on-dark surfaces (login brand panel): white bg, dark-emerald text */
        "primary-on-dark": "gradient-btn-on-dark border-0 shadow-sm hover:shadow-md",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline:
          "border bg-background font-medium shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        ghost: "font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20",
        link: "text-primary font-medium underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2.5 has-[>svg]:px-4", // brand scale-down px-5 py-2.5
        lg: "h-12 px-6 py-3 has-[>svg]:px-5", // brand full px-6 py-3 (hero/login)
        sm: "h-8 px-3 gap-1.5 text-xs has-[>svg]:px-2.5",
        xs: "h-6 px-2 gap-1 text-xs [&_svg:not([class*='size-'])]:size-3",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-xs": "size-6",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);
```

Rules: `default` cva key becomes `primary` (keep `default` as an alias mapped to primary during migration so untouched call sites don't silently change _meaning_, then delete the alias in the final cleanup PR — Iron Law 10). `.gradient-btn` hover already does translateY(-1px) + glow in 200ms — no per-page hover classes. Icon buttons in chrome (theme toggle, panel toggles) become `rounded-lg` too via base (drop their `rounded-full` overrides in `theme-toggle.tsx:42,59`, `app-header.tsx:40`, `workspace-toolbar.tsx:63`).

### 2.2 Inventory — exists / missing / recipe

| Component                                                       | Status                                    | Standard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button                                                          | exists, wrong geometry                    | §2.1. Never compose `gradient-btn` at call sites again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Input                                                           | exists (`ui/input.tsx`)                   | Keep. Standard height h-9; login/forms may use `h-11` but keep `rounded-lg` — kill the `rounded-xl` overrides (`login/page.tsx:149,161`, `app/page.tsx:59,89`). Numeric inputs add `font-mono tabular-nums text-right`.                                                                                                                                                                                                                                                                                                                                 |
| Select                                                          | exists (`ui/select.tsx`, unused in pages) | Adopt everywhere a native `<select>` exists **except** assignment (documented Radix-portal e2e constraint, `assignment/page.tsx:9-12`) — restyle assignment's natives with a shared `.native-select` recipe: `h-9 rounded-lg border border-input bg-background px-3 text-sm`. Dashboard wizard + SourceViewer migrate to shadcn Select.                                                                                                                                                                                                                 |
| Dialog                                                          | exists, unused                            | New-deal wizard moves from inline glass card (`app/page.tsx:223-232`) into Dialog (focus trap, Esc, scroll lock for free).                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Table                                                           | exists                                    | Standard: wrap in `glass-card rounded-xl overflow-x-auto`; numeric columns `text-right font-mono text-[13px] tabular-nums`; header `text-xs uppercase tracking-wider text-muted-foreground`; row h-9 (36px) default, h-8 dense.                                                                                                                                                                                                                                                                                                                         |
| Badge                                                           | exists                                    | Badges stay `rounded-full` (status language). Add semantic recipes as thin wrappers, not new variants: severity (`bg-severity-*` text-white), DSCR traffic light (`bg-dscr-good/warn/bad` — thresholds from policy pack at render time, Iron Law 8, per `globals.css:12-13`).                                                                                                                                                                                                                                                                           |
| Tabs                                                            | **missing**                               | Add shadcn Tabs (Radix) and re-skin as the existing segmented pill: list `rounded-full bg-muted/60 p-0.5`, trigger `rounded-full px-3 py-1.5 text-xs font-medium data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm`. Replaces hand-rolled `role="tablist"` in `workspace/page.tsx:218-237` and inspector pills in `workspace-toolbar.tsx:87-104` — this is what fixes arrow-key nav + aria wiring (current buttons have `role="tab"` but no roving tabindex, and the toolbar pills have no aria state at all). |
| Skeleton                                                        | **missing**                               | `ui/skeleton.tsx`: `<div className={cn("shimmer rounded-lg", className)} />` — the `.shimmer` utility already exists (`globals.css:445-464`). Per-surface skeleton compositions (§3). `grid-loader` demoted to route-level `loading.tsx` and full-page auth boundaries only.                                                                                                                                                                                                                                                                            |
| EmptyState                                                      | **missing**                               | `ui/empty-state.tsx`: icon-in-tile (`h-12 w-12 rounded-xl bg-primary/10 text-primary`), title (`text-lg font-semibold`), one sentence, **one primary action + optional secondary link** — mandatory (§3). Pattern already half-exists in review's "Queue clear" (`review/page.tsx:199-207`) — extract it.                                                                                                                                                                                                                                               |
| StatTile                                                        | **missing**                               | Extract from dashboard (`app/page.tsx:179-195`): `glass-card rounded-xl p-5` + icon tile + `text-2xl font-bold tabular-nums` value + label; optional delta slot (server-computed string only — Iron Law 3).                                                                                                                                                                                                                                                                                                                                             |
| PageHeader                                                      | **missing**                               | `ui/page-header.tsx`: `<h1 className="text-xl font-bold tracking-tight">` + description + actions slot. Replaces the five hand-rolled header blocks (`page.tsx:198-204`, `documents:132-140`, `costs:31-36`, `review:172-187`, `assignment:98-106`).                                                                                                                                                                                                                                                                                                    |
| Tooltip                                                         | **missing**                               | Add shadcn Tooltip; replace bare `title=` on information-bearing chrome (doc-completeness ticks `page.tsx:283-292`, cost ⚠ `costs/page.tsx:85`, stage chips). AG Grid keeps its own tooltips.                                                                                                                                                                                                                                                                                                                                                          |
| Sheet, Breadcrumb, Avatar, ScrollArea, Command, Popover, Switch | **missing**                               | Needed by shell v2 (§4): Sheet = mobile sidebar + mobile inspector; Breadcrumb = top bar; Avatar = user menu; Command (add `cmdk` dep) = palette; Popover = bell + source peek; Switch = settings. All vendorable from shadcn new-york against the `radix-ui` umbrella already in use.                                                                                                                                                                                                                                                                  |

---

## 3. Quality bar — the checklist every surface must pass

A surface ships only when all nine pass. (This becomes a PR-description checklist.)

1. **Loading = skeleton of the real layout.** Route `loading.tsx` may use `grid-loader`; in-page queries render Skeleton compositions matching final geometry (stat tiles → 3 tiles; board → 4 columns × 2 cards; tables → header + 5 rows; spread → grid header + rows at 38px). Never a bare spinner in content areas; never render "0 deals" while loading (dashboard currently does — `page.tsx:150-158` treats `undefined` as `[]`).
2. **Empty state = explanation + next action.** Every zero-state names the action that fills it (dashboard column "—" fails; costs/assignment empty rows fail).
3. **Error state = message + recovery.** `query.error` renders an inline alert with a Retry button (`utils.x.invalidate()`); mutations keep toast + inline `role="alert"`. No unhandled `.error` (dashboard `board.error`, costs, workspace `deal.error` currently unhandled).
4. **Keyboard + focus.** Global `:focus-visible` ring exists (`globals.css:563-567`) — the bar is: no click-only div (documents drop zone `documents/page.tsx:144-161` needs `role="button" tabIndex={0}` + Enter/Space), real Tabs semantics, shortcuts documented in a `?`-key sheet, shortcut handlers ignore events from editable targets (`e.target` check — review's handler relies on there being no other inputs).
5. **Aria.** Landmarks per zone (workspace already has `aria-label` on nav/aside), `aria-current="page"` on nav, `role="progressbar"` + `aria-valuenow` on progress (review `review/page.tsx:175-186`), text alternative for color-only signals (confidence dots, checklist ticks, ⚠).
6. **Responsive.** No dead ends: workspace rail (`max-md:hidden`) and inspector (`max-lg:hidden`, `workspace/page.tsx:113,274`) get Sheet fallbacks — click-to-source must work on a 13" laptop with both panels and on tablet.
7. **Dark parity.** Tokens only; no raw palette classes for meaning (documents' `border-l-red-400` file-kind borders are decorative — acceptable, but new work uses tokens).
8. **Density.** Bank users read tables: numerics `font-mono text-[13px] tabular-nums text-right`, rows 36–38px, labels 13px, no line-wrapping money. AG Grid values in `lib/ag-grid-theme.ts` are the reference density.
9. **Motion restraint.** 150–250ms, transform/opacity only, `prefers-reduced-motion` respected (§1 CSS + `useReducedMotion()` in framer components). No infinite decorative animation on authed surfaces.

---

## 4. App shell v2

### 4.1 Wireframe

```
┌──────────────┬────────────────────────────────────────────────────────────┐
│ ORG SWITCHER │ TOP BAR (h-14, frosted-toolbar)                            │
│ ▾ First Natl │  Deals / Acme Holdings / Review     [⌘K Search…] 🔔3 ◐ (P) │
│  Bank  ADMIN ├────────────────────────────────────────────────────────────┤
├──────────────┤                                                            │
│ WORKSPACE    │                                                            │
│ ● Deals      │                 PAGE CONTENT                               │
│ ○ Documents  │   (workspace keeps its three-zone cockpit +                │
│ ○ Reports    │    metrics strip inside this frame; sidebar                │
│              │    auto-collapses to icon rail on /workspace)              │
│ CURRENT DEAL │                                                            │
│  Acme Hldgs  │                                                            │
│ ○ Workspace  │                                                            │
│ ○ Documents  │                                                            │
│ ○ Review  ⑭  │                                                            │
│ ○ Assignment │                                                            │
├──────────────┤                                                            │
│ ORG          │                                                            │
│ ○ Members    │                                                            │
│ ○ Settings   │                                                            │
│ «  v0.9      │                                                            │
└──────────────┴────────────────────────────────────────────────────────────┘
 sidebar: 256px expanded · 56px icon rail · Sheet on <md · cookie-persisted
```

- **Org switcher (top):** tenant name + role badge from `trpc.me`. Today `profiles.tenant_id` is single-valued (`0000_schema-v1.sql:22`) so it renders as identity, not a picker — but it owns the top slot so multi-org lands without relayout (open question Q1).
- **Sections:** WORKSPACE (Deals `/`, Documents `/documents` — new cross-deal surface, Reports `/reports` — costs moves here as its first tab), CURRENT DEAL (contextual, appears when the route matches `/deals/[dealId]/*`; Review shows the live queue count from `trpc.review.progress` — server-computed number, client renders), ORG (Members, Settings).
- **Active state:** `aria-current="page"`, `bg-sidebar-accent text-sidebar-accent-foreground font-medium` + 2px `bg-sidebar-primary` left edge bar. Tokens `--sidebar-*` already exist (`globals.css:121-129,175-183`) — this is the first consumer.
- **Collapse:** toggle at footer + `[` shortcut; state in a cookie (`credexis:sidebar`) read by the server layout so SSR renders the right width (no flash — same trick as the theme boot script). Icon rail shows tooltips (Tooltip component) on hover; CURRENT DEAL section collapses to icons with badge counts.
- **Top bar:** Breadcrumb (server data: section / deal name / subpage — replaces both `AppHeader` breadcrumb and `WorkspaceToolbar` identity row), search seam (a read-only input that opens the Command palette, `⌘K` hint), notification bell (Popover, unread count badge), ThemeToggle, Avatar menu (email, role, Sign out form action — moves out of `AppHeader:61-73`).
- **Workspace integration:** the cockpit (`workspace/page.tsx` three zones + `MetricsStrip`) renders as shell content at full bleed. `WorkspaceToolbar` slims to deal-local controls only — statement tabs stay in center pane; inspector Tabs + rail/panel toggles + XLSX export remain; back-arrow/logo/theme/deal-name rows are deleted (now shell concerns). Shell sidebar auto-collapses to icon rail on entry (user can pin it open; pref persisted).

### 4.2 Component tree

```
app/(auth)/login/page.tsx                    — outside shell (unchanged layout)
app/(shell)/layout.tsx                       — server: reads cookie, renders shell
├─ SidebarProvider (collapse state, cookie)
│  ├─ AppSidebar
│  │  ├─ OrgSwitcher            (trpc.me)
│  │  ├─ SidebarSection "Workspace"  → SidebarItem[]
│  │  ├─ SidebarDealSection     (route-aware; trpc.deals.get + review.progress)
│  │  ├─ SidebarSection "Org"
│  │  └─ SidebarFooter          (collapse toggle, app version)
│  └─ SidebarInset
│     ├─ TopBar (frosted-toolbar h-14)
│     │  ├─ MobileSidebarTrigger (Sheet, <md)
│     │  ├─ Breadcrumbs
│     │  ├─ SearchSeam → CommandPalette (cmdk, portal)
│     │  ├─ NotificationBell (Popover + trpc.notifications)
│     │  ├─ ThemeToggle
│     │  └─ UserMenu (Avatar + DropdownMenu + signout form)
│     └─ {children}
└─ Toaster (stays in root layout)
```

Deleted the day the last consumer migrates (Iron Law 10): `components/app-header.tsx`; `WorkspaceToolbar` shrinks to `WorkspacePanelBar`.

### 4.3 Per-page migration order (each = one branch/PR, shell behind nothing — it ships page by page)

| Step | Page                                    | Work                                                                                                                          | Risk                                                                                                                                |
| ---- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1    | —                                       | Primitives PR: Button v2 (§2.1) + Skeleton/Tabs/Tooltip/EmptyState/PageHeader/StatTile + globals.css motion/on-dark additions | Low — visual diff only; e2e names preserved (see `review/page.tsx:248-252` accessible-name constraint: keep single-`<span>` labels) |
| 2    | `(shell)` group + `costs` → `/reports`  | Introduce layout, sidebar, top bar; move simplest page in; redirect `/costs` → `/reports`                                     | Low                                                                                                                                 |
| 3    | Dashboard `/`                           | AppHeader out; wizard → Dialog; skeletons; empty/error states                                                                 | Med                                                                                                                                 |
| 4    | `documents`, `assignment`               | Deal-context sidebar section lights up; keyboard-fix drop zone                                                                | Med                                                                                                                                 |
| 5    | `review`                                | Keep keyboard flow byte-for-byte; shell chrome only                                                                           | Med (e2e-sensitive)                                                                                                                 |
| 6    | `workspace`                             | Cockpit inside shell; WorkspaceToolbar → WorkspacePanelBar; Tabs component; Sheet inspector for <lg                           | High — last                                                                                                                         |
| 7    | cleanup                                 | Delete `app-header.tsx`, `default` Button alias, per-page `rounded-full/gradient-btn` stragglers (grep gate in CI)            | Low                                                                                                                                 |
| 8    | Notifications/Members/Settings surfaces | New pages on the now-stable shell (schema below)                                                                              | Med                                                                                                                                 |

---## 5. Schema DDL sketches (Drizzle-style) — what the shell needs server-side

Design constraints honored: RLS keyed on `current_tenant_id()` (`0001_rls-v1.sql:18-24`), append-mostly with audit (M2.5 triggers, `0004_audit-writer.sql`), pipeline writes via `credexis_worker` policies — never a service-role key in a request path.

```ts
// packages/schema/src/notifications.ts
export const notificationKind = pgEnum("notification_kind", [
  "pipeline_complete",
  "review_ready",
  "gate_failed",
  "transcript_received",
  "export_ready",
  "member_joined",
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  recipientId: uuid("recipient_id")
    .notNull()
    .references(() => profiles.id),
  dealId: uuid("deal_id").references(() => deals.id), // nullable: org-level events
  kind: notificationKind("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  href: text("href").notNull(), // deep link the bell navigates to
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  readAt: timestamptz("read_at"), // sole mutable column (see RLS)
});
// Rows are append-only except read_at. Notifications are operational chrome,
// not underwriting record — they do NOT join the audit_record() trigger set.

export const userPrefs = pgTable("user_prefs", {
  profileId: uuid("profile_id")
    .primaryKey()
    .references(() => profiles.id),
  sidebarCollapsed: boolean("sidebar_collapsed").notNull().default(false),
  density: text("density").notNull().default("comfortable"), // 'comfortable' | 'compact'
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});
// Presentation-only; theme stays in localStorage (theme-toggle.tsx works, keep it).

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  email: text("email").notNull(),
  role: userRole("role").notNull().default("underwriter"),
  invitedBy: uuid("invited_by")
    .notNull()
    .references(() => profiles.id),
  status: text("status").notNull().default("pending"), // pending|accepted|revoked
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  resolvedAt: timestamptz("resolved_at"),
});
// Role changes on profiles + invitation status changes DO join the audit
// trigger set (bank-visible authz events).
```

### RLS policy sketches

```sql
alter table public.notifications enable row level security;
-- read own bell only
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and recipient_id = auth.uid());
-- mark-read is the ONLY user write; column-level grant enforces it
revoke update on public.notifications from authenticated;
grant  update (read_at) on public.notifications to authenticated;
create policy notifications_mark_read on public.notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());
-- producers: pipeline worker (NOLOGIN role, 0001 pattern) + admins fan out member events
create policy notifications_worker_insert on public.notifications
  for insert to credexis_worker with check (true);

alter table public.user_prefs enable row level security;
create policy user_prefs_own on public.user_prefs
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

alter table public.invitations enable row level security;
create policy invitations_admin on public.invitations
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- Members admin: allow admins to change same-tenant roles (profiles currently select-only)
create policy profiles_admin_update_role on public.profiles
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin')
  with check (tenant_id = public.current_tenant_id());
-- + audit trigger on profiles (role) and a trigger blocking tenant_id/id changes.
```

### tRPC router surface (additions)

```
notifications.list({ cursor?, limit? })     → { items, nextCursor }
notifications.unreadCount()                 → { count }        // server counts; client renders
notifications.markRead({ id })              // update read_at via RLS above
notifications.markAllRead()
prefs.get() / prefs.set({ sidebarCollapsed?, density? })
members.list()                              → same-tenant profiles + pending invitations
members.setRole({ profileId, role })        // admin-gated in authz middleware AND RLS
members.invite({ email, role })             // [PRATIK] email delivery provider undecided —
members.revokeInvite({ id })                //  procedure lands; send step flagged, never faked
search.query({ q })                         → { deals[], entities[], documents[] }  // ILIKE/tsvector,
                                            //   tenant-scoped by RLS; feeds ⌘K palette
documents.recent({ limit? })                → cross-deal list for the global Documents surface
```

Bell freshness: poll `unreadCount` at 30s initially (matches existing polling idiom, e.g. `deals.board` 15s); upgrade path is Supabase Realtime on `notifications` (RLS-compatible) — open question Q2.

---

## 6. UI surface inventory (post-shell)

| Surface                         | Route                               | Status                                      |
| ------------------------------- | ----------------------------------- | ------------------------------------------- |
| Login                           | `(auth)/login`                      | exists — restyle to Button v2 geometry only |
| Deal pipeline dashboard         | `(shell)/`                          | exists — migrate                            |
| Workspace cockpit               | `(shell)/deals/[dealId]/workspace`  | exists — migrate last                       |
| Deal documents                  | `(shell)/deals/[dealId]/documents`  | exists — migrate                            |
| Review queue                    | `(shell)/deals/[dealId]/review`     | exists — migrate                            |
| Assignment                      | `(shell)/deals/[dealId]/assignment` | exists — migrate                            |
| Reports (costs tab)             | `(shell)/reports`                   | rename/move of `costs`                      |
| Documents (global)              | `(shell)/documents`                 | new (documents.recent)                      |
| Members                         | `(shell)/settings/members`          | new                                         |
| Settings (profile/prefs/tenant) | `(shell)/settings`                  | new                                         |
| Notifications (full list)       | `(shell)/notifications`             | new (bell "view all")                       |
| Command palette                 | overlay                             | new                                         |

---

## 7. The audit — surface × criteria punch list

P = pass, ~ = partial, F = fail. Criteria: (1) loading skeleton (2) empty+action (3) error+recovery (4) keyboard (5) aria (6) responsive (7) dark (8) density (9) motion.

| Surface                                         | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   | Worst offenders (file:line)                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard `app/page.tsx`                        | F   | F   | F   | ~   | ~   | P   | P   | ~   | ~   | loading renders "0 deals"/empty columns (`:150-158`); column empty state is "—" (`:300-304`); `board.error` never rendered; checklist ticks title-only (`:283-292`); no reduced-motion; native selects in wizard (`:64-107`); CTAs `rounded-full` (`:132,207`)                                 |
| Workspace `deals/[dealId]/workspace/page.tsx`   | F   | ~   | F   | F   | ~   | F   | P   | P   | P   | deal name "…" placeholder (`:93`); entity empty state has no link to assignment (`:263-265`); `role="tablist"` without arrow keys/panel wiring (`:218-237`); inspector unreachable <lg — click-to-source dead on tablet (`:274`); toolbar pills no aria state (`workspace-toolbar.tsx:87-104`) |
| Spread grid `workspace/spread-grid.tsx`         | F   | ~   | F   | P   | ~   | P   | P   | P   | P   | grid-loader not skeleton (`:243-258`); error = bare `<p>` (`:260-262`); confidence dots color-only (`:222-228` — tooltip exists, needs cell aria)                                                                                                                                              |
| Source viewer `workspace/source-viewer.tsx`     | ~   | P   | ~   | ~   | ~   | F   | P   | P   | P   | entirely off-system controls (`:171-223`); "Loading source…" text only (`:110`); inherits inspector's <lg dead end                                                                                                                                                                             |
| Review `deals/[dealId]/review/page.tsx`         | F   | ~   | ~   | P   | ~   | P   | P   | P   | P   | grid-loader (`:127-147`); "Queue clear" lacks next action (`:199-207`); error has no retry (`:149-164`); progress bar not `role="progressbar"` (`:175-186`); shortcut handler doesn't filter editable targets (`:90-116`)                                                                      |
| Documents `deals/[dealId]/documents/page.tsx`   | F   | ~   | F   | F   | ~   | P   | P   | P   | P   | grid-loader (`:202-215`); drop zone is click-only div (`:144-161`); `docs.error` unhandled; stage chips title-only (`:248-259`)                                                                                                                                                                |
| Assignment `deals/[dealId]/assignment/page.tsx` | F   | F   | P   | P   | P   | P   | P   | P   | P   | grid-loader (`:118-131`); empty row copy without action (`:224-230`) — otherwise the best-behaved surface                                                                                                                                                                                      |
| Costs `costs/page.tsx`                          | F   | F   | F   | P   | ~   | P   | P   | P   | P   | grid-loader (`:38-51`); empty copy no action (`:95-101`); `costs.error` unhandled; ⚠ char + title only (`:83-89`)                                                                                                                                                                             |
| Login `login/page.tsx`                          | P   | n/a | P   | P   | P   | P   | P   | n/a | F   | infinite float blobs, no reduced-motion (`:61-65`); off-standard `rounded-xl h-11` controls (`:149,161,166`)                                                                                                                                                                                   |
| Chrome (AppHeader/WorkspaceToolbar/ThemeToggle) | n/a | n/a | n/a | P   | ~   | ~   | P   | P   | P   | duplicated chrome systems; `rounded-full` icon buttons throughout; AppHeader has no mobile nav affordance                                                                                                                                                                                      |

Global fails: no `prefers-reduced-motion` (all), no Skeleton component (all), no Tabs primitive (workspace), sign-out/back patterns duplicated per page (shell fixes).

---

## 8. "Better than AWS/Google consoles" — what it concretely means

Their structural weaknesses: nav sprawl (hundreds of services → hunting), cognitive load (every screen a different team's design), inconsistent density (forms at 16px next to tables at 12px), trust-free numbers (a value on screen has no provenance). Our structural advantages: one product, one opinionated flow (Intake → Parsing → Review → Complete), and a data model where **every number already carries lineage** (`facts` spine, ARCHITECTURE §5) — the UI just has to spend it.

Five signature interactions (each maps to existing server truth; client renders, never computes):

1. **⌘K everywhere.** Palette with tenant-scoped `search.query`: jump to any deal/entity/document, plus verbs — "New deal", "Export XLSX", "Recompute", "Request 8821", "Go to review (14 left)". AWS's search finds services; ours finds _your borrower_ and acts. (cmdk dep + search router.)
2. **Source peek.** Hover/`space` on any spread cell → Popover with the exact PDF crop (bbox from `source.factDetail`, page image prefetched on row hover via signed URL); click still opens the full inspector. The number-to-evidence loop drops to ~300ms. No LOS or cloud console can show _why_ a number is what it is in one keypress.
3. **Cell history timeline.** Right-click (or `h`) on a cell → its append-only life: extracted (vendor+confidence) → consensus → transcript-verified → overridden by whom, when, from what value — read straight off `facts.superseded_by` chains + `audit_log`. Bank examiners get screenshot-able provenance; this is the auditability wedge as a UI gesture.
4. **Zero-refresh review cadence.** Optimistic accept/correct/reject in the review queue and workspace overrides (tRPC optimistic updates with rollback + toast on error): the keyboard flow never waits on a round trip, keeping <5s/field honest, while the metrics strip re-renders from the authoritative recompute when it lands (engine stays the only computer — Iron Law 3).
5. **Policy strip that explains itself.** The compliance chips (`metrics-strip.tsx:33-64`) gain a click-through popover: rule text, threshold, measured value, margin, and the **policy pack version the deal is pinned to** — "DSCR ≥ 1.15 per SOP 50 10 8 §…, you're at 1.31, pack v3 (deal pinned)". Consoles show limits as documentation; we show them as adjudicated, versioned facts on the deal.

---

## 9. Open questions

1. **Multi-org:** is the org switcher a real picker (requires `profiles` → `memberships(profile, tenant, role)` M-N split — a significant auth/RLS migration since `current_tenant_id()` assumes one tenant) or identity-only for MVP? Recommendation: identity-only now; reserve the slot.
2. **Bell freshness:** 30s polling vs Supabase Realtime on `notifications` (RLS applies to Realtime) vs Trigger.dev Realtime piggyback. Polling first; measure.
3. **Invitation delivery** [PRATIK]: email provider undecided (no email infra in repo). Procedures + table land; sending is flagged, never fabricated.
4. **Assignment selects:** does the Radix-portal e2e constraint (`assignment/page.tsx:9-12`) still hold with current Playwright setup, or can assignment adopt shadcn Select in step 4?
5. **Workspace sidebar default:** auto-collapse to icon rail on `/workspace` (recommended) vs remember-last. Needs a quick usability check with the design-partner brokers (M10.7).
6. **Glass on shell:** keep `.glass-card` content language inside a solid `--sidebar` shell (recommended — glass sidebars fail contrast on busy content), or extend glass to the shell?
7. **Density toggle scope:** `user_prefs.density` — tables only (row 36→32px, AG Grid `rowHeight` 38→32) or global type scale? Recommendation: tables only.
8. **⌘K "jump to cell":** requires a server-side index of taxonomy labels per deal — worth it for MVP2 or defer to Final?
