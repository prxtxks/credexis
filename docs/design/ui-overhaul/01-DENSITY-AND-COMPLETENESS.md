# 01 — Density & Completeness ("it looks unfinished")

**Status:** proposed — supersedes nothing, amends `00-DESIGN-LANGUAGE.md` §2 Density (see §3.3).
**Directive (Pratik, 2026-07-29), verbatim:**

> "our apps ui looks repetitive card like structures and looks ai made. Look in phone the home screen has three cards that occupy space just for basic metrics. We need to be enterprise grade and organized. We need web portal like claude has or vercel has in saying for the phone."

> "Out app is past mvp1 but it looks unfinished. Like if i go to profile settings i have so less options. A fully ready deployed claude app wont have this less. Think about what we can keep adding to make it look like a finished product"

Both complaints are correct, both are measurable, and neither is fixed by adding UI. This document is mostly a list of deletions.

---

## 1. Diagnosis

### 1.1 The card is the only container the app owns

`.glass-card` is defined once (`apps/web/src/app/globals.css:357-367`) and applied **39 times across 18 files**. The only other containers in `apps/web/src/components/ui/` are `card.tsx` — a _second_, redundant surface that is used 3 times and **always with `className="glass-card"` stacked on top of it** (`apps/web/src/app/settings/page.tsx:65,101,125`; `apps/web/src/app/deals/[dealId]/borrower/page.tsx:219`; `apps/web/src/app/auth/reset-password/page.tsx:54`) — plus `empty-state.tsx` (the same box, dashed) and `table.tsx` (used twice, both times _inside_ a `glass-card`).

There is no list primitive, no section-header primitive, no segmented control, no disclosure. So everything that is a list of things becomes a stack of cards, **because a card is the only shape available.** That is the mechanical cause of "repetitive card like structures."

The app has already reinvented the missing primitive twice, by hand, inside cards: `divide-y divide-border/60` at `apps/web/src/app/org/members/page.tsx:145` and `:211`. It just never extracted it.

### 1.2 The phone home spends 64% of the first screen before showing a single deal

Measured at 375×812 against `apps/web/src/app/dashboard-client.tsx`:

| Band                       | Source                                                                                                  | Height          |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | --------------- |
| Top bar                    | `app-shell.tsx:108` (`h-14`)                                                                            | 56px            |
| Page top pad               | `dashboard-client.tsx:166` (`py-8`)                                                                     | 32px            |
| Three stat tiles stacked   | `dashboard-client.tsx:169` — `grid-cols-1 … sm:grid-cols-3`; `sm`=640px, so **every** phone stacks them | ~296px + `mb-8` |
| "Deal pipeline" + subtitle | `dashboard-client.tsx:195-201`                                                                          | ~68px           |

First pixel of actual deal content lands at **~484px** down an 812px screen. Usable band, after the tab bar reserved by `max-md:pb-20` (`app-shell.tsx:137`), is 812 − 56 − ~82 = **674px**. So **428 of 674px — 64% — is three numbers and a sentence explaining to a banker what a pipeline is.**

It is worse than three cards. The four-column board (`dashboard-client.tsx:229`, `grid-cols-1 … md:grid-cols-2 xl:grid-cols-4`) stacks into four vertical sections on a phone, and each **empty** column still renders a dashed placeholder (`dashboard-client.tsx:308-312`). An org with two deals in review scrolls past three dashed "No deals" boxes to reach them.

### 1.3 Two of those three numbers are structurally always zero

`deals.status` is **never written anywhere in the repo.** The enum has four values (`packages/schema/src/db/enums.ts:30`), `deals.create` relies on the column default `'intake'` (`packages/schema/src/db/deals.ts:21`), and the only `UPDATE` that exists against the `deals` table in the entire codebase is `transcripts_enabled` (`apps/web/src/server/trpc/routers/transcripts.ts:57-58`). No migration, no trigger, no pipeline task writes it.

Therefore:

- Three of four board columns are permanently empty.
- "In review" and "Complete" (`dashboard-client.tsx:155-156, 160-161`) can never read anything but **0**.
- The phone's _deal_ screen leads with `{deal.data?.status ?? "…"}` in `text-lg font-bold` (`apps/web/src/app/deals/[dealId]/workspace/page.tsx:116`) — a headline that reads "intake" forever.

**This is a missing state machine wearing a layout problem's clothes.** Restyling the home screen before fixing it is cosmetics on a board that cannot move.

### 1.4 The signed-in user does not exist anywhere in the shell

The top bar is bell + theme + a bare `<form action="/auth/signout">` (`app-shell.tsx:119-135`). No name, no initials, no role, no org, no account menu. The user's own name appears in exactly one place in the product: the text input on `/settings` that sets it (`settings/page.tsx:80-86`). Every portal Pratik named anchors the top-right on identity. Its absence is why the shell reads as scaffolding rather than software.

### 1.5 Settings is thin because the backend is two columns wide

`profile.update` accepts exactly `fullName` and `emailNotifications` (`apps/web/src/server/trpc/routers/profile.ts:36-39`), and the SECURITY DEFINER behind it physically cannot write anything else (`packages/schema/drizzle/0019_own-profile-settings.sql:6-9`). So `/settings` is three fat cards over **two writable fields and one "email me a link" button**. Nothing can be added to that screen without adding backend — which is exactly why it will keep looking unfinished until §5 Tier 2 lands.

And it is three _fat_ cards specifically because `Card` contributes `py-6 gap-6` while `.glass-card` wins the surface on source order. Two competing surface implementations fighting on the same DOM node, and the loser's only surviving contribution is padding.

### 1.6 The stated moat has zero UI

`audit_log` is fully built: columns and per-tenant sha256 chain (`packages/schema/src/db/audit.ts:28-36`), an RLS SELECT policy open to every authenticated tenant member (`packages/schema/drizzle/0001_rls-v1.sql:285-286`), and `verify_audit_chain(uuid)` already `GRANT EXECUTE`d to `authenticated` (`packages/schema/drizzle/0024_audit-hash-chain.sql:149`). There is **no audit router** (`ls apps/web/src/server/trpc/routers/` — 16 files, none of them audit) and no screen. `apps/web/src/app/api/deals/[dealId]/export/route.ts:2-4` states in its own header that "export is also an audit-worthy event" and then writes no row.

### 1.7 The type scale exists only on paper

`00-DESIGN-LANGUAGE.md:43` specifies 24/18/15/13/11. Actual counts across `apps/web/src/app` + `components`:

- **On scale:** `text-2xl`×4, `text-lg`×6, `text-[15px]`×4, `text-[13px]`×4, `text-[11px]`×14 = **32**
- **Off scale:** `text-sm`×89, `text-xs`×80, `text-xl`×18, `text-base`×13, `text-[10px]`×21, plus one-offs = **~225**

**87% of the type in this app is default Tailwind, not the approved scale.** That single ratio is the mechanical cause of the design doc's own §1.2 complaint ("no typographic conviction") and of "looks ai made." Geometry drifted the same way: `rounded-[14px]` is written longhand at `dashboard-client.tsx:179,254,309` when `rounded-xl` already resolves to exactly 14px (`--radius: 0.625rem` at `globals.css:87`, `--radius-xl: calc(var(--radius) + 4px)` at `globals.css:58`). Seven longhand radii total.

### 1.8 Eight copies of a nine-span spinner

`.grid-loader` is hand-written as nine `<span />` elements in eight files (`costs/page.tsx`, `deals/[dealId]/loading.tsx`, `assignment/page.tsx`, `borrower/page.tsx`, `review/page.tsx`, `documents/page.tsx`, `spread-grid.tsx`, `tax-spread-grid.tsx`) — ~72 lines of duplicated JSX — while `components/ui/skeleton.tsx` sits with zero importers and `00-DESIGN-LANGUAGE.md:86` explicitly asks for "skeleton rhythm."

### 1.9 Seven dead files (Iron Law #10)

Zero importers, symbol-grep verified: `components/ui/stat-tile.tsx`, `tabs.tsx`, `dialog.tsx`, `tooltip.tsx`, `skeleton.tsx`, `separator.tsx`, `dropdown-menu.tsx`, and `components/app-header.tsx` (superseded by `app-shell.tsx`, never deleted).

Note the irony in `stat-tile.tsx`: it was built in M11.1 to standardize exactly the tiles Pratik is complaining about, and `dashboard-client.tsx:174-191` hand-rolls them anyway. It also puts `font-mono` on a money value (`stat-tile.tsx:34`), which the design language reserves for identifiers.

### 1.10 Summary: why "more cards" is the disease

Every symptom above has the same root: **the app has one container and no vocabulary.** When the only shape is a card, a list becomes a stack of cards; a group of two fields becomes a card; a spinner becomes a card; an empty column becomes a dashed card. Uniform containers at uniform spacing with uniform 14px type is precisely what generated UI looks like, because generated UI has no reason to prefer one shape over another.

The cure is a **vocabulary of three or four containers used deliberately**, plus deletion of everything that exists only to fill space. Enterprise-grade is not more chrome; it is fewer objects, each of which does something.

---

## 2. Where the two audits disagreed — and what we chose

| #   | Disagreement                                                                                                                                                           | Choice                                                                                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Stat tiles**: merge into a segmented filter (counts become navigation) vs. delete outright and replace with a dense text line ("12 deals · 3 in review · 2 blocked") | **Segmented filter.**                                                                                                                                                                                                                                                                                                                                     | A count that does nothing is decoration; a count that filters is navigation. Same information, 328px → 32px, _more_ function. A dense text line is strictly worse: still unactionable, still costs a row.                                                                                                                                                                    |
| 2   | **Sequencing**: restyle the home first vs. fix `deals.status` first                                                                                                    | **Status first (§5, Tier 1 step 3).**                                                                                                                                                                                                                                                                                                                     | Ship the filter before the state machine and it reads "All 12 / Review 0 / Complete 0" forever — a more sophisticated way of showing the same two permanent zeros. The status writer needs **no migration** (enum + column exist), so it is cheap _and_ unblocking.                                                                                                          |
| 3   | **`stat-tile.tsx`**: delete vs. adopt it in `dashboard-client.tsx`                                                                                                     | **Delete.**                                                                                                                                                                                                                                                                                                                                               | The tile is the artifact being removed. Adopting it standardizes the mistake, and `stat-tile.tsx:34` contradicts the type rules anyway.                                                                                                                                                                                                                                      |
| 4   | **`dropdown-menu.tsx` / `dialog.tsx`**: delete as dead vs. consume them for the account menu and shortcut sheet                                                        | **Keep — with a rule.** A dead primitive survives _only_ if a numbered step in this document consumes it. `dropdown-menu.tsx` → step 2; `dialog.tsx` → step 11; `skeleton.tsx` → step 10. `tabs.tsx`, `tooltip.tsx`, `separator.tsx`, `stat-tile.tsx`, `app-header.tsx` have no consumer and die in step 1. If step 11 is cut, `dialog.tsx` dies with it. | Iron Law #10 says dead code dies the day it dies. A file with a scheduled consumer three PRs out is not dead; a file with no consumer is, regardless of how nice it is.                                                                                                                                                                                                      |
| 5   | **Audit viewer placement**: cheap Tier-A screen vs. blocked on narrowing the RLS policy                                                                                | **Ship the read-only screen on today's policy (Tier 1, step 4); narrow the policy separately (Tier 3, step 15) if Pratik decides viewers should not see it.**                                                                                                                                                                                             | Today _every_ tenant member can already read the whole audit log via the DB/API (`0001_rls-v1.sql:285-286`). A screen does not widen the posture — it makes the existing posture visible. Blocking the moat's only UI on a policy debate trades the highest-value demo artifact in the product for zero security gain. The PR description records the acceptance explicitly. |
| 6   | **Nav**: keep four top-level destinations vs. absorb Members into Settings                                                                                             | **Absorb.** `/org/members` → `/settings/members`; nav drops to **Deals · Costs · Settings** + account menu.                                                                                                                                                                                                                                               | Members is an org-settings surface eating a top-level slot (`app-shell.tsx:33`) while nine of fourteen routes are unreachable from nav at all. This is consolidation, not addition.                                                                                                                                                                                          |
| 7   | **`00-DESIGN-LANGUAGE.md:60-62`** ("cards over tables everywhere below md")                                                                                            | **The approved doc is wrong on this line and gets amended in the same PR as the density fix.**                                                                                                                                                                                                                                                            | That clause is what produced the screen Pratik is objecting to. See §3.3.                                                                                                                                                                                                                                                                                                    |

Both audits independently flagged `app-header.tsx` and `stat-tile.tsx` as dead, and both flagged the three stat tiles as the primary offense. Those are not in dispute.

---

## 3. Rules this plan does not break

### 3.1 Iron laws

- **#3 — the client never computes.** Nothing here adds metric math to `apps/web`. The CI grep-check (`docs/MASTER_TASK_LIST.md:132`) stays green. Deal-status _transitions_ are workflow state, not metrics: the client sends an enum and re-renders server truth. Filtering an already-fetched array by `status` is selection, not arithmetic.
- **#2 — money is integer cents.** `apps/web/src/lib/money-display.ts:1-4` is pure string work and stays that way. **New rule for the primitives below: `ListRow`'s `trailing` prop is typed `string`, never `number`** — so a monetary value structurally cannot be formatted at the call site.
- **#8 — thresholds come from `policy_packs`.** Nothing in this plan renders a threshold comparison client-side; DSCR traffic-lighting stays where it is.
- **#10 — docs change with behavior.** Every step below that changes a documented decision amends the doc in the same PR, and new task IDs are appended to `docs/MASTER_TASK_LIST.md` in their own PR.
- **#7 / #6** — every new route stays behind the existing JWT middleware; the one new router (`audit`) is `protectedProcedure` reading through RLS.

### 3.2 e2e accessible-name contracts

**Verified free** — grep of `apps/web/e2e/` for `Deal pipeline`, `Total deals`, `In review`, `Sign out`, `Members`, `Settings` returns **nothing**. The deals home, the sign-out control, and the nav are unasserted and may be restructured.

**Must be preserved byte-for-byte:**

| Contract                                                              | Where asserted                                     | Where implemented                                                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `role="button"` named Scenario / Issues / Add-backs / Source          | `workspace-e2e.live.spec.ts:148`                   | `workspace-toolbar.tsx:92-109` — `Segmented` therefore renders `<button>` **by default** and only opts into `role="tab"` |
| `role="tab"` + `aria-selected` on spread tabs                         | contract recorded at `components/ui/tabs.tsx:9-13` | `workspace/page.tsx:272-291`                                                                                             |
| `getByLabel("metrics strip")` contains `$180,000.00` / `$260,000.00`  | `workspace-e2e.live.spec.ts:151,170`               | `components/workspace/metrics-strip.tsx` — untouched                                                                     |
| `getByRole("heading", { name: <deal name> })`                         | `workspace-e2e.live.spec.ts:145`                   | workspace header — untouched                                                                                             |
| `FieldSelect ariaLabel="Invite role"` and `` `role for ${m.email}` `` | X4 invariants                                      | `org/members/page.tsx:109,164` — **must survive the file move in step 8**                                                |
| Single-`<span>` label wrapping                                        | `components/ui/button.tsx:15-18`                   | every multi-child button label                                                                                           |

**One contract changes, deliberately:** the theme toggle. `prod-smoke.spec.ts:121` asserts `getByRole("button", { name: /Switch to (light|dark) mode/ })` — but that test runs against **`/login`**, and `/login` renders its own `ThemeToggle` at `login/page.tsx:104`, outside `AppShell`. Moving `ThemeToggle` out of `app-shell.tsx:122` into the account menu therefore leaves the spec valid. The step-2 PR must state this and re-run `prod-smoke` to prove it.

**One contract silently rots and must be repaired in the same PR:** `prod-smoke.spec.ts:96` is the stuck-fallback outage detector —

```ts
await expect(page.locator(".grid-loader")).toHaveCount(0);
```

If step 10 removes every `.grid-loader` from the app, that assertion becomes **vacuously true** and the detector stops detecting. This is the M11.5 notification-index failure mode exactly (`docs/MASTER_TASK_LIST.md`, M11.5 postmortem): a guard that silently stops guarding. Step 10 retargets it at the skeleton's marker in the same PR, or it does not merge.

### 3.3 Amendment to `00-DESIGN-LANGUAGE.md` §2 Density

The current text reads:

> **Density.** Desktop = data cockpit (13px rows OK). Mobile = iOS app: 16px base, 44pt touch targets, generous whitespace, one column, cards over tables everywhere below md.

That last clause is what built the screen Pratik is objecting to. It was **right** that a 13-column grid must not be shrunk onto a phone. It was **wrong** to conclude that each row needs its own floating card. Replacement text, landing in the step-9 PR:

> **Density.** Desktop = data cockpit (13px rows OK). Mobile = iOS app: 44pt touch targets, one column, and **one surface per group with hairline-separated rows — never one card per row.** "Cards over tables" means _do not shrink a wide grid onto a phone_; it never meant _give every row its own container_. Whitespace is spent **between groups**, not between rows. A screen with more than three distinct surfaces above the fold is over-containered.

---

## 4. The delete / merge ledger

Stated plainly, up front, because this plan is net-negative in files and net-negative in DOM nodes.

### 4.1 Files deleted

| File                                       | Reason                                                      |
| ------------------------------------------ | ----------------------------------------------------------- |
| `apps/web/src/components/app-header.tsx`   | 0 importers; superseded by `app-shell.tsx`                  |
| `apps/web/src/components/ui/stat-tile.tsx` | 0 importers; standardizes the thing being removed           |
| `apps/web/src/components/ui/tabs.tsx`      | 0 importers; superseded by `segmented.tsx`                  |
| `apps/web/src/components/ui/tooltip.tsx`   | 0 importers; unreachable on touch, no planned consumer      |
| `apps/web/src/components/ui/separator.tsx` | 0 importers; hairlines are borders                          |
| `apps/web/src/components/ui/card.tsx`      | 3 importers, all of which stack `glass-card` on top of it   |
| `apps/web/src/app/org/members/page.tsx`    | moves to `settings/members/page.tsx` (redirect left behind) |

### 4.2 Code deleted

| What                                                                                       | Where                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stats` array + three tiles + icon squares + `Briefcase`/`Activity`/`CheckCircle2` imports | `dashboard-client.tsx:16,158-192`                                                                                                                           |
| Subtitle "Intake through complete — documents in, pro-forma out."                          | `dashboard-client.tsx:198-200`                                                                                                                              |
| Four dashed "No deals" placeholders                                                        | `dashboard-client.tsx:308-312`                                                                                                                              |
| `hover:-translate-y-0.5` on the deal card                                                  | `dashboard-client.tsx:254`                                                                                                                                  |
| Both `staggerChildren: 0.06` blocks                                                        | `dashboard-client.tsx:172,244`                                                                                                                              |
| `breadcrumb="SBA 7(a) Underwriting"` → `"Deals"`                                           | `dashboard-client.tsx:165` (on mobile the breadcrumb **is** the page title — `app-shell.tsx:114-118` — so today the phone's one title slot holds a tagline) |
| Bare sign-out `<form>` + `ThemeToggle` in the top bar                                      | `app-shell.tsx:122-134`                                                                                                                                     |
| `Members` nav entry (4 destinations → 3)                                                   | `app-shell.tsx:33`                                                                                                                                          |
| Private `RailSection` component                                                            | `workspace/page.tsx:42-51`                                                                                                                                  |
| Hand-rolled tablist                                                                        | `workspace/page.tsx:272-291`                                                                                                                                |
| Hand-rolled inspector pill group                                                           | `workspace-toolbar.tsx:92-109`                                                                                                                              |
| Two hand-rolled `divide-y` row groups                                                      | `org/members/page.tsx:145-197, 211-230`                                                                                                                     |
| Per-document / per-invitation cards                                                        | `documents/page.tsx:232`, `borrower/page.tsx:398`                                                                                                           |
| Eight nine-span `.grid-loader` blocks (~72 lines)                                          | 8 files listed in §1.8                                                                                                                                      |
| Seven longhand `rounded-[14px]` / `rounded-[20px]`                                         | `dashboard-client.tsx:179,254,309` + 4                                                                                                                      |

### 4.3 Merged

- **Three stat cards → one 32px segmented filter.** Same three numbers, now controls.
- **Four stacked kanban columns (mobile) → one scroll list with sticky section headers**, ordered by urgency (Review, Parsing, Intake, Complete) rather than by funnel order. A banker on a phone is triaging, not admiring a funnel. Desktop kanban at `md+` is untouched — it is a good desktop view that is simply the wrong shape in a 375px column.
- **`/org/members` → `/settings/members`.**
- **`Card` + `glass-card` → one surface.**
- **`/settings` (one flat page) → a settings _section_** with profile / notifications / security / members / audit.

---

## 5. The ordered plan

Ordered by **value per hour**. One task ID per branch, conventional commits, acceptance criterion quoted in the PR description. Every UI PR carries the 375/768/1024/1440 screenshot matrix required by `00-DESIGN-LANGUAGE.md:92-97`.

### Tier 1 — cheap and visible (no migration; the backend already exists)

**1. `ui-14-1-dead-ui-sweep`**
Delete `components/ui/stat-tile.tsx`, `tabs.tsx`, `tooltip.tsx`, `separator.tsx`, and `components/app-header.tsx`. Keep `dropdown-menu.tsx` (step 2), `skeleton.tsx` (step 10), `dialog.tsx` (step 11).
_Accept:_ grep across `apps/web/src` returns zero references to every deleted symbol, and the rendered DOM is byte-identical on all 14 routes.

**2. `ui-14-2-account-menu`**
New `components/account-menu.tsx` on the existing `dropdown-menu.tsx`. Trigger = initials circle from `profile.get().fullName` (a server string — no computation). Menu shows name, email, role badge, org name, → Settings, theme toggle, Sign out. **Deletes** `app-shell.tsx:122-134`.
_Accept:_ every shell page's top-right shows the signed-in user's initials and the open menu names their role and org; `prod-smoke.spec.ts:121` still passes because `/login` keeps its own toggle at `login/page.tsx:104`.

**3. `m8-10-deal-status`** — _the highest value-per-hour step in this document_
`deals.setStatus({dealId, status})` on `underwriterProcedure`, plus pipeline transitions: `intake → parsing` on the first `documents` row, `parsing → review` when the review queue is non-empty, `review → complete` as an explicit human action. **No migration** — `deal_status` (`packages/schema/src/db/enums.ts:30`) and `deals.status` (`packages/schema/src/db/deals.ts:21`) already exist; only the writer is missing.
_Accept:_ uploading a deal's first document moves it Intake → Parsing with no human action, all four board columns can hold deals in a seeded fixture, and the client-math CI grep stays green.

**4. `m12-3-audit-viewer`**
New `routers/audit.ts`: `audit.list({limit, cursor, action?, tableName?, actorId?, since?})` and `audit.verifyChain()` → `ctx.supabase.rpc("verify_audit_chain", { p_tenant })`. Both plain `protectedProcedure` reads — `0001_rls-v1.sql:285-286` and the `GRANT EXECUTE` at `0024_audit-hash-chain.sql:149` already permit them, so **no migration**. Screen is a **dense table** (`components/ui/table.tsx`, not cards) at `/settings/audit`, actors resolved against `members.list`, `before`/`after` in an expandable diff row, and a chain banner. Carry the honesty note from `0024_audit-hash-chain.sql:10-15` verbatim: rows before 0024 were backfilled, so tamper evidence is meaningful only from 0024 forward — marketing does not get to round that up.
_Accept:_ a fact override performed in the workspace appears in the viewer with actor, before/after and timestamp, and the chain banner reads "intact"; the PR description records that today's policy lets any tenant member read it (see §2 row 5 and Pratik decision D4).

**5. `m12-3-export-audit`**
Write one `export.xlsx` audit row in `apps/web/src/app/api/deals/[dealId]/export/route.ts`.
_Accept:_ downloading a workbook produces exactly one audit row visible in step 4, and the header comment at `:2-4` is finally true.

### Tier 2 — density (the actual complaint)

**6. `ui-14-3-list-and-section-primitives`**
Add `components/ui/list.tsx` (`List`, `ListRow`) and `section-header.tsx` (`SectionHeader`) per §6. Primitives land **with their first consumer, never alone**: convert `/org/members`' two hand-rolled `divide-y` groups (`org/members/page.tsx:145-197, 211-230`) and its two `<h2>` headers (`:144, :203`).
_Accept:_ at 375px the members page renders as two grouped surfaces with hairline rows instead of stacked cards, no new `glass-card` occurrence is introduced, and `ariaLabel="Invite role"` (`:109`) and `` `role for ${m.email}` `` (`:164`) are unchanged.

**7. `ui-14-4-segmented-control`**
Add `components/ui/segmented.tsx`. Adopt it in the two existing hand-rolled tracks: `workspace/page.tsx:272-291` and `workspace-toolbar.tsx:92-109`.
_Accept:_ spread tabs still emit `role="tab"` + `aria-selected` and inspector pills still resolve as `role=button` with names Source / Issues / Add-backs / Scenario; `workspace-e2e.live.spec.ts` green or updated in the same PR.

**8. `ui-14-5-deals-board-counts`**
`deals.board` (`routers/deals.ts:80-89`) returns `{ deals, counts: { total, review, complete } }` and per-deal `docsHave` / `docsNeed`. It already holds every row in hand (`deals.ts:36-38`), so this is free. Removes the client counting at `dashboard-client.tsx:155-156` and the checklist arithmetic at `:248-250`. **Not** an Iron Law #3 fix — these are workflow counts, not engine metrics — but a number the user _acts on_ should be server truth.
_Accept:_ `dashboard-client.tsx` contains no `.filter(...).length` and no `have.length/checklist.length`, and the board renders identically.

**9. `ui-14-6-deals-home-density`** — _the screen Pratik pointed at_
Rebuild the mobile home per §7. Below `md`, four kanban columns collapse into **one** scroll list with sticky section headers ordered Review → Parsing → Intake → Complete; the three stat tiles become the three labels of the segmented filter; empty groups render **nothing** (only the whole-list-empty case gets an `EmptyState` with a real first-run CTA). At `md+` the kanban is untouched. **Amends `00-DESIGN-LANGUAGE.md` §2 Density in this PR** (§3.3).
_Accept:_ on a 375×812 viewport the first deal row's top edge is at **≤200px** (today: ~484px), and a brand-new org sees one first-run panel rather than four dashed "No deals" boxes.

**10. `ui-14-7-skeleton-rhythm`**
Wire `components/ui/skeleton.tsx`; delete all eight `.grid-loader` blocks. **Retarget `prod-smoke.spec.ts:96` at the skeleton's marker in this same PR** (§3.2) — an outage detector that can no longer fire is worse than none.
_Accept:_ `grep -r "grid-loader" apps/web/src` returns only the `globals.css` definition or nothing at all, **and** deliberately breaking a page's data fetch still fails `expectNoStuckFallback`.

**11. `ui-15-1-settings-section`**
`settings/layout.tsx` + `components/settings-nav.tsx` (vertical sub-nav desktop, horizontal scroller mobile). Split into `/settings/profile` (name + read-only identity block), `/settings/notifications` (the email switch), `/settings/security` (step 12), `/settings/members` (`org/members/page.tsx` moved verbatim), `/settings/audit` (step 4). **Delete `components/ui/card.tsx`** and rewrite its 3 importers onto `glass-card` + `SectionHeader`. **Delete** the `Members` nav entry; nav becomes Deals · Costs · Settings.
_Accept:_ all sub-routes render inside one settings shell at 375px and 1440px, `/org/members` redirects, `card.tsx` no longer exists, and every X4 accessible name on the members page is unchanged.

**12. `m12-3-session-controls`** — _directly answers "so less options"_
Lift `apps/portal/src/lib/session-age.ts` (already written) into `packages/shared` and apply it in `apps/web/src/middleware.ts`. `/settings/security` gains **Sign out everywhere** (`supabase.auth.signOut({ scope: 'others' })`), **in-app password change** (`updateUser({ password })`), and **email change** (Supabase double-confirmation, scoped in M11.3 and never shipped). **No schema.** State plainly on the page that a per-device session list is _not_ offered, because it needs the auth admin API which Iron Law #7 bars from a request path — say so rather than faking a device list.
_Accept:_ signing out everywhere invalidates a second browser on its next request, a session past the absolute ceiling redirects to `/login`, and the page names the session-list limitation in prose.

**13. `m12-3-mfa-enroll`**
TOTP enroll → QR → challenge/verify → factor list → unenroll on `/settings/security`, via the Supabase MFA API. **No schema for enrollment itself.** Org-wide `require_mfa` enforcement is Tier 3.
_Accept:_ a user enrolls, signs out, signs back in and is challenged for a code; unenroll works; the recovery path is documented on-screen.

**14. `ui-15-2-shortcuts-and-about`**
`?` opens a dialog listing the review-queue shortcuts that already exist (`deals/[dealId]/review/page.tsx:91-117`) and are documented nowhere in the UI. Account-menu **Help** shows support contact, app version, `engine_version` and the deal's pinned `policy_pack` version — all already stamped on server data (`export/route.ts:163-165`). This is the step that justifies keeping `dialog.tsx`. **Do not build ⌘K**: it needs a `search` router that does not exist.
_Accept:_ pressing `?` anywhere in the shell lists every shortcut the product actually implements, and no shortcut is listed that does not work.

**15. `ui-15-3-type-scale-gate`**
Add named type tokens (`text-label` 11 / `text-meta` 13 / `text-body` 15 / `text-title` 18 / `text-display` 24) and a CI grep gate banning **new** off-scale sizes. Convert the five one-off sizes now (`text-[9px]`, `text-[10px]`×21, `text-[26px]`, `text-[40px]`, `text-4xl`); convert `text-sm`/`text-xs` route-by-route as each route is next touched, not in one 200-file sweep. Same PR retires the seven longhand radii for `rounded-xl`.
_Accept:_ the five one-off sizes reach zero occurrences, the CI gate fails on a newly-introduced `text-[10px]`, and no `rounded-[14px]` remains.

### Tier 3 — needs schema, RLS harness scenarios, or a Pratik decision

**16. `m11-9-org-settings`** — `/settings/organization`: org name, kind, upload limits. Needs a write path: today only `tenants_select_own` exists (`0001_rls-v1.sql:82-83`), with **no UPDATE policy at all**. Follow the established narrow-definer pattern — `update_org_settings(p_name, p_kind, p_limits)` restricted to `org_owner`/`admin`, `search_path` pinned, EXECUTE revoked from public/anon, exactly like `update_own_profile` (`0019`) — because RLS cannot restrict columns and `settings` must not become a free-form write. Surfaces `settings.limits.maxDocsPerDeal` / `maxBytesPerDeal` (60 docs / 1 GiB) that the `0021` trigger **already enforces against users who cannot see them.**
_Accept:_ the RLS harness proves an `underwriter` cannot write org settings and an `org_owner` can, lowering `maxDocsPerDeal` immediately changes what the `0021` trigger rejects, and the change appears in the step-4 audit viewer via the existing `tenants` trigger.

**17. `m12-3-audit-policy-narrowing`** — _gated on Pratik decision D4._ If viewers should not read the org audit log, narrow `audit_log_select` to `org_owner`/`admin` (+ `auditor` when M12.2 lands), with harness scenarios.
_Accept:_ the harness proves a `viewer` reads zero audit rows and an `admin` reads all of them.

**18. `m11-7-notification-granularity`** — per-kind email preferences, the explicitly remaining half of M11.7. New settings key or table + RLS + harness + digest-job changes.

**19. `m12-1-borrower-reminders`** — `borrower_invites.last_reminded_at` (`packages/schema/src/db/borrower.ts:140`) is returned by `borrowerInvites.forDeal` (`routers/borrower.ts:116`) and **never written by any procedure**. The T+7 reminder is scoped and unbuilt.

**20. `m12-3-retention`** — retention / deletion / tenant offboarding export. **Policy decision before engineering:** `audit_log` has UPDATE/DELETE revoked from every role (`0004_audit-writer.sql:74-80`), so "delete my data" and "immutable audit trail" must be reconciled _in writing_ before any code is written.

**21. `m12-2-role-capabilities`** — `role_capabilities` + `role_can()` are fully designed (`docs/design/platform/01-identity-rbac.md:91-133`) and zero-built; `user_role` still has four values (`packages/schema/src/db/enums.ts:11`). Enum extension + table + swapping ~50 inline policy predicates + harness. Do not start without knowing which roles a pilot customer needs (D5).

**Known debt, not scheduled:** `deals.board` returns every deal with no `limit` and no pagination (`routers/deals.ts:36-38`) and refetches every 15s (`dashboard-client.tsx:141`). Fine at pilot scale; it becomes the mobile home's primary query in step 9, so add a cursor before the first tenant crosses ~200 deals.

---

## 6. New primitives — exact densities

Three added, seven-plus deleted. 8pt grid, scale 24/18/15/13/11, 44pt touch targets.

**`components/ui/list.tsx` → `List`, `ListRow`**
One `surface-1` container, `rounded-xl` (= 14px), **no per-row border, no per-row shadow**. `ListRow`: min-height 64px, `px-4 py-3`; line 1 at 15px/600, truncating, with `trailing` right-aligned and `tabular-nums`; line 2 at 13px/400 at 60% foreground, dot-joined. Optional `leading` = a 6px status dot; optional `accent` (`"warning" | "critical"`) = a 2px bar inset on the left edge. Rows separated by a **1px hairline inset 16px from the left** (`border-black/6` light, `border-white/8` dark) — the inset is what makes the group read as one surface instead of a stack. **`trailing: string`** — never `number` (Iron Law #2).
_Replaces:_ `dashboard-client.tsx:246-307`, `org/members/page.tsx:145-197` and `:211-230`, `documents/page.tsx:223-276`, `borrower/page.tsx:396+`, `workspace/page.tsx:182-190`. Below `md` it also replaces the `<Table>` bodies at `costs/page.tsx:63-100` and `assignment/page.tsx:152+`, with the real `<Table>` retained at `md+`.

**`components/ui/section-header.tsx` → `SectionHeader({ label, count, action, sticky })`**
32px tall, sticky within its scroll container, `bg-background`. Label 11px uppercase `tracking-wide` at 60%; count 11px `tabular-nums` right-aligned.
_Replaces:_ `dashboard-client.tsx:234-239`, `org/members/page.tsx:144` and `:203`, `borrower/page.tsx:347-349`, `documents/page.tsx:134-143`; **deletes** `RailSection` at `workspace/page.tsx:42-51`.

**`components/ui/segmented.tsx` → `Segmented({ options: {value,label,count}[], value, onChange, ariaLabel, role })`**
32px track, `rounded-lg` (= 10px), 4px inner pad, `rounded-md` thumb, labels 13px, counts 11px `tabular-nums`, thumb transition 150ms ease-out per `00-DESIGN-LANGUAGE.md:56`. **Contract: it accepts the ARIA shape rather than imposing one** — renders `<button>` by default (the inspector-pill contract) and opts into `role="tab"` + `aria-selected` (the spread-tab contract). Adopting it must not silently rewrite either.

**Where tabular numerals are load-bearing, not decoration:** the segmented counts and every `SectionHeader` count. `deals.board` runs `refetchInterval: 15_000` (`dashboard-client.tsx:141`), so proportional digits make every count reflow its own label every fifteen seconds — an observable bug, not a style preference. The existing column pill already gets this right (`dashboard-client.tsx:236`). Ratios and money stay Geist tabular at medium+ weight, **never `font-mono`** — `font-mono` is for identifiers only (`documents/page.tsx:269`, `review/page.tsx:219`).

---

## 7. The target phone home, and what not to do

**Hierarchy, top to bottom (375×812):**

| y   | h    | What                                                                            |
| --- | ---- | ------------------------------------------------------------------------------- |
| 0   | 56px | Top bar (`app-shell.tsx:108`), title reads **"Deals"**                          |
| 56  | 16px | `py-4 md:py-8` — the 32px pad becomes desktop-only                              |
| 72  | 36px | Search (`flex-1`, h-9) + `New deal` as `size="icon"` h-9 below `sm`             |
| 116 | 32px | `Segmented` carrying the three counts: `[ All 12 ] [ Review 4 ] [ Complete 3 ]` |
| 156 | 32px | Sticky `SectionHeader`: **IN REVIEW 4**                                         |
| 188 | 64px | **First deal row**                                                              |

**The deal row.** Today the card is six visual objects for one deal (`dashboard-client.tsx:254-303`: name, DSCR pill, type badge, issue pill, "DOCUMENTS 3/5", five dots). New: two lines, 64px. Line 1 `Acme Holdings acquisition` … `1.42×`. Line 2 `business acquisition · 3/5 docs · 2 issues`, with `2 issues` in `text-severity-warning` and a 2px amber bar inset on the left edge — no colored card, no pill. The five checklist dots survive only at `md+`: their `title={c.label}` tooltip (`:292`) is unreachable on touch, so on a phone they are five meaningless dots and `3/5 docs` says the same thing legibly. The whole row is one `<Link>`, as today (`:253`), so the accessible name stays the deal name.

**Explicitly forbidden — the things that would make it look _more_ AI-generated:**

1. **No greeting hero.** "Good morning, Pratik — here's your pipeline" is the loudest AI-dashboard tell and costs a viewport.
2. **No replacing three stat cards with four smaller ones**, a 2×2 grid, or a horizontally-scrolling chip carousel. Horizontally scrolling your primary numbers is tell #2.
3. **No sparklines, trend arrows, or "+12% vs last week."** `deals.board` returns no time series (`routers/deals.ts:80-89`). Producing one requires either client math (Iron Law #3) or an invented series (Iron Law #1). There is nothing to trend.
4. **No progress rings or percentage bars per deal.** `3/5` already reads perfectly; a ring around it is decoration wrapped around a number.
5. **No icon or avatar on every row.** Icon-per-row is what makes a list read as generated. The only leading glyph is a 6px status dot, and only in the unfiltered view where the group header is not already carrying status.
6. **No staggered fade-up on the list.** Motion is for state change, not arrival (`00-DESIGN-LANGUAGE.md:56-58`).
7. **No row-background colorization by status.** Emerald is reserved for primary action / active nav / positive state (`00-DESIGN-LANGUAGE.md:47-50`). Status lives in one dot and one amber count. Nowhere else.
8. **No pull-to-refresh, no FAB speed-dial, no bottom sheet for filters.** One `New deal` affordance, one inline filter.
9. **No separate mobile component tree.** `borrower/page.tsx:393-395` already documents why in this codebase: a parallel mobile card duplicates every button's accessible name. One DOM that reflows at `md`.
10. **No returning the tagline "SBA 7(a) Underwriting"** to any mobile surface — on a phone the breadcrumb _is_ the page title.
11. **No new longhand radii and no new `text-[10px]`.** `rounded-xl` is already 14px; the type floor is 11px.

---

## 8. Decisions that are Pratik's, not engineering's

| #      | Decision                                                                                                                                                                                                                                | Blocks                                         | Engineering's recommendation                                                                                                                                                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | **Billing surface — build what?** There is no billing schema anywhere. `PRICING-STRATEGY.md:26-40` prices banks on annual contracts with included deal files and brokers at ~$250/deal self-serve. Those imply completely different UI. | A "Plan & usage" panel in the settings section | For MVP2 build a **read-only** Plan & usage panel (plan name from a `tenants.settings.plan` key, deal files consumed this period from a server-side count) and **no payment UI, no Stripe**. Contract customers do not self-serve; a fake billing page is worse than none. |
| **D2** | **Avatars: uploads or initials?**                                                                                                                                                                                                       | Step 2 (account menu)                          | **Initials only** — no storage bucket, no image moderation, no extra PII, and it is indistinguishable at 28px.                                                                                                                                                             |
| **D3** | **Does `deal_access_mode` ('open' vs 'team', `01-identity-rbac.md:161-177`) ship now?** It changes deal RLS for every existing customer.                                                                                                | Step 21                                        | Defer until a pilot asks by name.                                                                                                                                                                                                                                          |
| **D4** | **May a `viewer` read the whole org audit log?** Today's policy says yes (`0001_rls-v1.sql:285-286`). Step 4 makes that visible without changing it.                                                                                    | Step 17                                        | Narrow to `org_owner`/`admin` (+ `auditor` when it exists) — but ship the viewer first; the screen changes who _does_ read, not who _can_.                                                                                                                                 |
| **D5** | **Which of the five M12.2 roles do pilot customers actually need?**                                                                                                                                                                     | Step 21                                        | `auditor` is the one a bank asks for by name; the other four may be deferrable indefinitely.                                                                                                                                                                               |
| **D6** | **Retention window** — how long does Credexis keep a completed deal's documents? This is a contract term, not a config default, and it collides head-on with the append-only audit log.                                                 | Step 20                                        | Write the answer down before any code; the collision is a policy resolution, not an engineering one.                                                                                                                                                                       |
| **D7** | **Support contact + brand voice for the Help item.** Grep for `support@`, `/help`, `contact us` across `apps/web/src` returns **zero hits** — the product currently offers a user no way to reach anyone.                               | Step 14                                        | One mailbox and one sentence. It is the cheapest "finished product" signal in this entire document.                                                                                                                                                                        |
