# Handoff — state of play, 2026-07-29

Written so a fresh session (or a fresh person) can pick up without reading a
day of chat. Keep it short and current; delete anything that stops being true.

## Where the product actually is

Shipped and live on main today (PRs #128–#139):

- **CI now proves a real production build renders.** Every PR builds for
  production, serves it, and asserts in a browser that the app hydrates with
  no stuck loading state and no blocked scripts. This exists because the app
  shipped broken to production twice in one day while every gate passed — the
  dev server renders differently, and both defects lived only in the
  production path.
- **Borrower portal, database layer: complete.** Migrations 0025–0032. A
  borrower is an `auth.users` row with **no `profiles` row, ever**; their
  whole authority is their invite. They match exactly two policies in the
  entire database, both on `storage.objects`, both pinned to their own upload
  folder. See `docs/design/platform/05-borrower-portal.md` (binding) and the
  memory note `borrower-portal-spine`.
- **Borrower portal, app layer:** `apps/portal` exists (claim → OTP → curated
  single screen), and brokers can invite/extend/revoke/request documents from
  `/deals/[dealId]/borrower`. **Uploads are not wired yet** — see below.
- **Product completeness (Tier 1 of the density plan):** account menu with
  identity, deal-status control, audit-log viewer, 267 lines of dead UI
  deleted. Plan: `docs/design/ui-overhaul/01-DENSITY-AND-COMPLETENESS.md`.

## Two pre-existing bugs found today, both fixed

Worth knowing because both were invisible and would have hit the first real
customer:

1. **Org owners could not write anything** (fixed in 0032). Every tenant
   write policy listed `('admin','underwriter')`; `org_owner` arrived later
   and no migration amended them — but `create_organization()` stamps every
   signup `org_owner`. 29 policies. Now expressed as `role_tier(...) >= 2`,
   so a future role slots in by rank instead of needing 29 more edits.
2. **The audit log out-ranked the tables it audits** (also 0032). It had no
   role predicate while `invites_select` needs admin tier, so a viewer could
   read invitee emails and token hashes out of audit rows. Narrowed.

Also fixed earlier: the audit trigger broke every `tenants` write, which had
silently broken new-org signup (0020); and pipeline notifications had never
worked because an `ON CONFLICT` could not infer a partial index (0022).

## What is NOT done

- **Borrower uploads.** The worker half was written, reviewed, and
  **rejected** — it called `invite_extraction_spend()` and cited a
  `documents_invite_path_guard` trigger that did not exist. Both now exist
  (migration 0031), so this is a clean rewrite against real guards, not a
  patch. This is the top of the queue.
- **Density work (Tier 2+ of the plan):** the phone home screen still spends
  three cards on three numbers. Plan is written and ordered; nothing built.
- `NEXT_PUBLIC_PORTAL_URL` must be set in Vercel and Trigger before any
  borrower sees a link, or broker-copied links and chase reminders point at
  the wrong origin (the chase task withholds sends rather than guessing).
- Key rotation before real borrower documents arrive — a launch-checklist
  item, not a code blocker (Pratik's call, 2026-07-29).

## UI state, 2026-07-29 evening — READ THIS FIRST if you are picking up UI

Pratik's standing verdict: the app still does not look like a finished
product, and UI is the top priority. His reference is Vercel's dashboard
(he is logged in and can supply screenshots of any view).

What has been done: `docs/design/ui-overhaul/00-DESIGN-LANGUAGE.md` (the
"Precision Instrument" language) and `01-DENSITY-AND-COMPLETENESS.md` (the
ordered plan, with a delete/merge ledger and a forbidden list worth reading
before adding anything). Tier 1 shipped: account menu, deal-status control,
audit viewer, 267 lines of dead UI deleted. Tier 2 partly shipped: the phone
home now leads with the work (first deal row 484px -> 182px), and a craft
pass added row surfaces, metadata pills, one shared loader, an always-present
logo, and removed a duplicated nav entry.

**What Pratik has explicitly rejected as still wrong:**

1. Desktop has had almost no attention — the whole density/craft effort so far
   has been phone-first. He wants Vercel-grade on BOTH.
2. `/settings` is still three stacked icon+title cards — the exact repetitive
   pattern he named twice. Plan step 11 (settings shell + sub-nav + grouped
   rows, delete `card.tsx`) is written and not started.
3. "I told you to add world class UI and this is what you changed?" — the
   honest read is that most of the day went into security and plumbing, and
   the visible surface still trails the engineering underneath.

**Lessons that cost real time today, do not relearn them:**

- Optimising for a pixel metric produced a bare screen. Dense != bare. Every
  row needs a surface, an edge, and right-aligned scannable data.
- Verify UI in a browser at 375px AND at desktop width, against a PRODUCTION
  build. The dev server renders differently and hid two outages.
- NEVER `rm -rf .next` while the dev server runs — it corrupts the build and
  produces blank pages that look like real bugs. I did this twice and once
  reported a false "users cannot sign in" alarm from it.
- An agent's confident report is not evidence. Two builds this week called
  database functions that did not exist. Read the files.

## Working rules learned the hard way

- **Verify against a production build, never the dev server**, for anything
  touching rendering, headers, or routing. That is now a CI gate.
- **When a fix makes a failure disappear, ask what it removed.** A "fix" to
  the harness grant-replay silently dropped ten real REVOKEs, which would
  have left the test environment more permissive than production.
- **An agent's confident report is not evidence.** Two builds this session
  claimed working code that called functions which did not exist. Every
  builder gets a reviewer that reads the actual files.
- **Check the exit status, not the log line.** A watch script printed
  "MERGED" after a pipe, so it fired even when the merge failed — PR #130 was
  reported merged when it was not. Use `&&`, not `;`.
