# Platform Shell (MVP 2.5) — Synthesis & Decisions

**Status: APPROVED — this document is authoritative.** The three design docs
(01–03) carry the full detail; where they conflict, THIS file and the
adversarial review (04) decide. Date: 2026-07-28. Owner: Pratik (CEO);
synthesized by Claude (CTO seat).

Why this exists: client walkthroughs (brokers, broker firms, SBA lenders)
begin soon. The product needs an identity/portal layer (orgs, roles,
delegated access), a notification center, entity↔document validation, and a
bank-grade UI standard — designed once, adversarially reviewed, then built
in the order below.

---

## 1. Decisions (binding)

### Identity & orgs (from 01, verdict-adjusted)

- **One org schema for everyone.** Banks, broker firms, and solo brokers are
  all `tenants` rows; a solo broker is an org of one (`org_kind:
'lender' | 'broker_firm' | 'solo_broker'`, advisory metadata — never an
  RLS predicate). No separate/reduced freelancer portal, ever.
- **One user = one org stays** (profiles PK = auth uid). Multi-institution
  humans get one seat per institution. Revisit at MVP 4 (LSP console).
- **LSP hierarchy = column only now** (`tenants.parent_tenant_id`, always
  NULL, self-parent CHECK). No policy traverses it until MVP 4.
- **Role set (final target)**: `org_owner`, `admin`, `loan_officer`,
  `underwriter`, `processor`, `auditor` (read-only + audit export),
  `it_admin`, `viewer`, + `external` per-deal collaborator seats.
  **Pre-pilot we ship only**: `org_owner` + existing
  `admin`/`underwriter`/`viewer` (verdict CUT list) — the rest are enum
  values reserved in the design, activated in M12+.
- **Originate ≠ decide** is the load-bearing separation: loan officers
  create/upload; underwriters decide facts/add-backs/overrides. This
  mirrors how banks are examined and is a sales asset.
- **A1 fix (required)**: the role-tier lattice is enforced IN RLS/definer
  functions, not just tRPC — an admin can never demote/deactivate
  `org_owner` nor mint an invite above their own tier, at the DB layer.
- **X1 fix**: Design 01's `invites` table (token_hash, expiry, revoked_at,
  append-mostly, definer accept) is authoritative. Design 03 §5's
  `invitations` sketch is void. Member routes live at `/org/members`,
  `/org/invites`.

### Notifications (from 02, verdict-adjusted)

- **X2 fix**: Design 02's notifications schema is authoritative (typed
  events, 4-state lifecycle `unread|read|actioned|dismissed`, dedupe keys).
  Design 03's sketch is void; 03's bell/panel UI binds to 02's router.
- **B1 fix (required)**: `notify()` is NOT a general RPC. Fan-out derives
  type/title/body server-side from a caller-class whitelist; borrower
  activity can only produce `borrower_upload` events keyed to their invite
  (or an AFTER INSERT trigger on documents); `action_url` validated
  app-relative in-function; per-invite rate limits.
- **B4 fix (required)**: honest worker posture — the pipeline writes
  notifications through the existing documented pattern (service-role
  client + explicit tenant checks in code), not a fictional
  `credexis_worker` connection.
- **X3 fix (required)**: recipients are capability-derived (e.g. approval
  notifications go to holders of the decide capability / deal leads),
  never "all admins+underwriters" nor `deals.created_by`.
- Pre-pilot scope: in-app center + at most one immediate email class.
  Digest infra, retention purge, messaging seam → M12.

### Entity↔document validation (from 02 — verdict: "iron-law-clean. Good.")

- New pipeline substage after split/classify: dual-path extraction of the
  printed taxpayer/business name (+ EIN/SSN-last4 where printed) as
  registry TEXT fields → **deterministic** matcher in packages/shared
  (token-set + Jaro-Winkler blend; middle names/initials, business
  suffixes, DBA handling; fixture table in 02 §3.7). The LLM locates; the
  math is ours (Iron Law #1).
- Bands: high → auto-confirm assignment (band OFF until eval gates can
  run); mid → actionable notification "Name matches NN% — approve?" (audit
  on decision); low/conflict → blocking issue (G7).
- Borrower-invite entity scoping feeds the matcher as a deterministic
  prior (Advisory 4).
- Match scores live on `document_identities` with full lineage; never in
  `facts`.

### UI standard & shell (from 03, verdict-adjusted)

- **Brand lock (measured from credexis.co)**: Geist everywhere (already
  matched); primary button = emerald 135° gradient, **rounded-lg (10px)**,
  Geist semibold 14px, px-6 py-3 (scalable), 200–300ms transitions;
  on-dark variant = white bg / dark-emerald text. Rolled out via Button
  component variants — never per-page classes.
- **Shell v2**: left sidebar (org switcher, Deals/Members/Settings
  sections, collapse) + slim top bar (breadcrumb, bell, theme, avatar).
  Workspace keeps its three-zone cockpit inside the shell.
- **C1 fix (required)**: DSCR/status badges render a SERVER-provided band
  string. The client never compares a metric to a threshold (Iron Laws
  #3/#8).
- **X4 rule (required)**: every shell/primitive PR either preserves the
  live e2e accessible-name contracts (deal-name `<h1>`, "Scenario"/"Issues"
  as buttons, "Queue clear" heading, exact-name "accept"/"correct"
  single-span labels, visible "✓ <filename>" text) or updates the spec in
  the same PR — listed per-PR in the checklist.
- Cut (pre-pilot): user_prefs table, density toggle, cmd-K palette, global
  /documents, /costs rename. Signature interactions → roadmap.

### Borrower portal (from 02 — deliberately LAST)

- Magic-link (Supabase OTP) borrower_invites scoped to (deal, entity);
  upload-only + own-uploads RLS; curated coarse status; checklist from
  deal type; one reminder at T+7 (pre-pilot).
- **B2 fix (required)**: borrower document INSERT policy pins
  `storage_path` to
  `<invite.tenant>/deals/<invite.deal>/borrower-uploads/<invite.id>/…`
  AND `runIngest` asserts the prefix (defense in depth). sha256-squatting
  409 oracle documented and mitigated.
- **B3 fix (required)**: storage policy validates EVERY path segment
  against the invite (tenant, deal, invite id) — covered by the RLS
  integration harness before ship.
- Ships only after: notifications + identity substage + RLS harness +
  upload quotas/AV enforcement (GAP list). Pilots run with
  underwriter-side uploads until then.

## 2. Bank vendor-security checklist (GAP list — tracked work, mostly M12)

Idle/absolute session timeouts · login/invite/upload rate limits + lockout
· per-invite upload quotas & pipeline cost ceilings · authentication event
logging (sign-ins, failed logins, OTP, revocations) queryable per tenant ·
EIN/SSN-last4 at-rest encryption decision · retention/deletion + tenant
offboarding export · audit-log retention + tamper evidence (hash chain) ·
SPF/DKIM/DMARC + email-provider DPA + subprocessor list · key rotation
before real borrower data (already ruled: at MVP 2 close) · CSP/security
headers · AV verdict enforced BEFORE extraction · RLS regression harness as
a CI gate for every new policy.

## 3. Build order (M11 milestones — verdict's first six PRs)

1. **M11.1 UI primitives**: Button v2 (brand geometry) + Skeleton/Tabs/
   Tooltip/EmptyState/PageHeader/StatTile + reduced-motion; e2e
   name-invariants in the PR checklist.
2. **M11.2 Org bootstrap**: org enums + `tenants.settings` +
   `profiles.status` + `org_owner`; `create_organization()`; `/signup` +
   `/welcome` (fixes the live signup dead-end).
3. **M11.3 Members & invites**: 01's `invites` + `/org/members` +
   `/org/invites` on the existing role floor; RLS tier lattice (A1); audit
   triggers on profiles/invites/tenants.
4. **M11.4 Identity groundwork**: persist `entity_hint`; packages/shared
   name-matcher with fixture table (pure TDD, no vendor spend).
5. **M11.5 Notifications + shell**: 02's schema with B1/B4 fixes +
   router + shell v2 with bell/panel.
6. **M11.6 Identity substage**: registry identity fields + pipeline
   substage (auto band OFF) + assignment-screen identity UI — gated on
   eval/CI green.
   Then **M12**: borrower portal (with B2/B3 + quotas + harness),
   remaining roles, digests, session hardening, GAP items.

## 4. Standing rules for every M11+ PR

Docs change with behavior · additive migrations only (enum values land one
migration file before first reference) · RLS integration tests for every
new policy · e2e contract preservation (X4) · no new hardcoded operational
constants (use `tenants.settings`) · verified-green CI before merge.
