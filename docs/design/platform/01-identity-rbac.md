All current-state files read. Composing the design document now.

# Design Doc — Identity, Organizations, Roles & Delegated Access ("Portal Layer")

Status: proposal for merge into `docs/ARCHITECTURE.md` · Grounded against the codebase as of commit `8baa66a` (2026-07-28)

---

## 0. Current state (verified, with citations)

| Fact                                                                                                                                                                                                                                                                               | Source                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Roles are a 3-value enum `user_role: admin \| underwriter \| viewer`                                                                                                                                                                                                               | `packages/schema/drizzle/0000_schema-v1.sql:17`                                        |
| `tenants` is a bare org table: `id, name, created_at` — no kind, no hierarchy, no settings                                                                                                                                                                                         | `0000_schema-v1.sql:29–33`                                                             |
| `profiles` is simultaneously the user record **and** the membership record: `id` (PK), `tenant_id NOT NULL`, `email`, `full_name`, `role` (default `underwriter`)                                                                                                                  | `0000_schema-v1.sql:20–27`                                                             |
| `profiles.id` is FK to `auth.users(id)` ON DELETE CASCADE — **PK = auth uid, therefore one user belongs to exactly one tenant**                                                                                                                                                    | `0002_auth-wiring.sql:13–15`                                                           |
| RLS tenancy resolves through two SECURITY DEFINER helpers: `current_tenant_id()` and `current_user_role()`, both `select … from profiles where id = auth.uid()`                                                                                                                    | `0001_rls-v1.sql:18–32`                                                                |
| The universal policy pattern is: select = any tenant member; insert/update = `role in ('admin','underwriter')`; delete = `admin` only                                                                                                                                              | `0001_rls-v1.sql:88–93` (comment) and every per-table policy, e.g. deals `0001:96–109` |
| `profiles` has a **select-only** policy (`profiles_select_same_tenant`, `0001:85–86`) — no insert/update policy exists, so membership creation is out-of-band today ("Profile creation is administrative for now… invite flow comes in a later milestone")                         | `0002_auth-wiring.sql:8–11`, `docs/environments.md:73–77`                              |
| Pipeline runs as `credexis_worker` NOLOGIN role scoped to pipeline tables; service-role key never in request paths                                                                                                                                                                 | `0001_rls-v1.sql:297–344`                                                              |
| Audit is DB triggers (`audit_record()`, SECURITY DEFINER) on facts / addbacks / loan_scenarios (+ logical_documents), append-only, all direct audit_log inserts revoked                                                                                                            | `0004_audit-writer.sql:11–80`, `0005_assignment-audit.sql`                             |
| Session gate: middleware refreshes cookies, `getUser()` revalidates JWT, fails closed; `PUBLIC_PATHS = ["/login", "/auth"]`; API routes self-authenticate                                                                                                                          | `apps/web/src/middleware.ts:9, 22–82`                                                  |
| tRPC tiers: `protectedProcedure` (user + profile), `underwriterProcedure = requireRole(["admin","underwriter"])`, `adminProcedure`                                                                                                                                                 | `apps/web/src/server/trpc/init.ts:16–42`                                               |
| Context loads `{id, tenant_id, role, email}` via an RLS-scoped query; role is enforced server-side only                                                                                                                                                                            | `apps/web/src/server/trpc/context.ts:28–51`                                            |
| Router surface today: `me, documents, review, assignment, addbacks, metrics, deals, spread, source, issues, policy, pipeline, transcripts` — every mutation is `underwriterProcedure`, every query `protectedProcedure`; **`adminProcedure` is exported but unused by any router** | `router.ts:19–65`; grep of `routers/*.ts`                                              |
| Storage RLS keys on the first path segment = tenant id; insert requires `role in ('admin','underwriter')`, delete admin-only                                                                                                                                                       | `0003_storage-layout.sql:36–58`, `docs/environments.md:58–67`                          |
| Auth providers: email/password live; Google OAuth wired in UI but provider unconfigured; sign-ups get nothing until a profile row exists                                                                                                                                           | `docs/environments.md:71–86`                                                           |
| Roadmap seams: MVP 3 = borrower portal (separate app/auth surface); MVP 4 = SSO (WorkOS-class) + LSP parent-org→child-bank multi-tenancy "on existing RLS"                                                                                                                         | `docs/ROADMAP.md:123–124`                                                              |
| Role tests fabricate contexts for `admin/underwriter/viewer` and assert tier rejection codes                                                                                                                                                                                       | `apps/web/src/server/trpc/authz.test.ts:14–30`                                         |

Design constraints inherited from CLAUDE.md iron laws #5 (append-mostly + lineage), #7 (JWT everywhere, RLS everywhere, no service-role in request paths) and ARCHITECTURE.md §2.10.

---

## 1. Org model

### 1.1 One schema for all org types — validated

**Recommendation confirmed: an org is an org; a solo broker is an org of one.** Reasoning from the existing code, not taste:

1. Every tenant-scoped table, every RLS policy, the storage key convention (`tenant_id/deals/…`, `environments.md:59–61`), and `learned_mappings` tenant scoping (`0001:269–282`) already key on `tenant_id`. A parallel "personal account" concept would fork ~19 tables' policies and the storage layout for zero isolation benefit — a solo broker needs _exactly_ the same isolation guarantees as a 40-seat bank.
2. Pricing (per-seat tiers, `docs/PRICING-STRATEGY.md` direction) and the upgrade path both fall out free: a freelancer who hires becomes a firm by inviting a second member — **no schema event occurs**. That upgrade-path test is the strongest validation of org-of-one.
3. The only real cost is UX: signup must auto-create an org without making a solo user "name their company." Solved in the bootstrap flow (§4.1) by defaulting `name` to the user's name and `kind = 'broker'`.

The org **type** is advisory metadata (drives defaults, labels, and later program packs), never an RLS predicate:

```
org_kind: 'lender' | 'broker_firm' | 'solo_broker'
```

`solo_broker` is a distinct value (not inferred from seat count) because a solo broker who buys a second seat for a VA is still commercially a solo shop; conversion to `broker_firm` is an explicit org-settings action.

### 1.2 LSP hierarchy — the MVP 4 seam, column only

Per `ROADMAP.md:124` ("LSP multi-tenancy (parent-org → child-bank hierarchy on existing RLS)"), design the column, not the feature:

```sql
alter table tenants add column parent_tenant_id uuid references tenants(id);
```

- MVP: always NULL; **no RLS policy traverses it**; no UI writes it. `current_tenant_id()` stays single-valued.
- MVP 4 activates it by adding _new_ policies (`… or tenant_id in (select id from tenants where parent_tenant_id = current_tenant_id() and <explicit delegation row exists>)`) — additive, no rewrite of the existing floor. Cross-org visibility will additionally require an explicit delegation table (an LSP must never see a child bank's deals by mere parentage); that table is deliberately **not** designed here.
- Constraint to add on day one so MVP 4 inherits clean data: `CHECK (parent_tenant_id IS DISTINCT FROM id)` (self-parenting). Depth-1 enforcement is a trigger in MVP 4.

### 1.3 One user = one org, kept deliberately

`profiles.id` PK = `auth.users.id` (`0002:13–15`) hard-codes single-org membership, and `current_tenant_id()` (`0001:18–24`) depends on it. **Keep this invariant.** For bank-grade software it is a feature: work identity is per-institution; an examiner asking "who could see this deal" gets a closed answer. The genuinely multi-org human (LSP underwriter serving three banks) is handled as three externally-invited seats — one email identity per institution, or plus-addressing — which is exactly how banks run contractor Active Directory accounts today. Revisit only at MVP 4 (flagged in §11).

---

## 2. Roles and the authorization matrix

### 2.1 Role set

Extend the existing `user_role` enum **in place** (Postgres 17 — `environments.md:37` — supports `ALTER TYPE … ADD VALUE`; each value in its own statement, used only in later migration files). No column rename, no data rewrite: existing `admin`/`underwriter`/`viewer` rows keep meaning what they mean, which is what keeps `0001`'s policies and `authz.test.ts` green during rollout.

```
user_role: admin | underwriter | viewer            -- existing (0000:17)
         + org_owner                               -- the accountable principal; billing; owner transfer
         + loan_officer                            -- BDO: originates, uploads, cannot decide facts
         + processor                               -- post-approval docs/checklists/exports
         + auditor                                 -- compliance_auditor: read-everything + audit export, zero writes
         + it_admin                                -- members/security only, NO deal data
         + external                                -- collaborator seat: per-deal grants only (§3)
```

Legacy mapping: `admin` becomes "org admin" (everything but billing/owner-transfer); `underwriter` unchanged (the fact-decider — today's `underwriterProcedure` semantics, `init.ts:39`); `viewer` retained as generic internal read-only (superset relationship: `auditor` = `viewer` + audit-log export; retire `viewer` later, §11).

### 2.2 Capability layer (how the matrix becomes enforceable without policy sprawl)

Today the role check is inlined into ~50 policy predicates as `current_user_role() in ('admin','underwriter')` (`0001` passim, `0003:49`, `0007_transcripts.sql:28,33`). Eight roles × that pattern is unmaintainable and un-auditable. Introduce a **seeded capability table + one helper**, so the matrix below exists in exactly one place (same philosophy as iron law #8: the matrix is data):

```sql
create table role_capabilities (
  role       user_role not null,
  capability text      not null,   -- e.g. 'facts.decide'
  primary key (role, capability)
);
-- Read-only reference data: RLS enabled, select-to-authenticated, writes via migrations only
-- (same pattern as taxonomy_nodes/policy_packs, 0001:72–77).

create or replace function public.role_can(cap text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.role_capabilities
                 where role = public.current_user_role() and capability = cap)
$$;
```

Capabilities (closed list, seeded by migration): `deals.read`, `deals.create`, `deals.delete`, `documents.upload`, `facts.decide` (review accept/correct/reject, overrides, addback decisions — the `underwriterProcedure` surface), `scenarios.write`, `exports.run`, `audit.read`, `audit.export`, `members.manage`, `security.manage`, `org.settings`, `billing.manage`.

### 2.3 Authorization matrix

Legend: ✓ = allowed org-wide · D = allowed only on deals granted via `deal_members` (§3) · R = read-only · — = denied (RLS returns zero rows / tRPC FORBIDDEN)

| Surface → / Role ↓     | Deals (view) | Deals (create/edit)         | Documents (upload)         | Review queue (decide)       | Addbacks & overrides | Scenarios   | Exports (XLSX)          | Audit log (view/export)     | Members & invites | Security settings (MFA policy, sessions) | Billing | Org settings |
| ---------------------- | ------------ | --------------------------- | -------------------------- | --------------------------- | -------------------- | ----------- | ----------------------- | --------------------------- | ----------------- | ---------------------------------------- | ------- | ------------ |
| **org_owner**          | ✓            | ✓                           | ✓                          | ✓                           | ✓                    | ✓           | ✓                       | ✓ / ✓                       | ✓                 | ✓                                        | ✓       | ✓            |
| **admin**              | ✓            | ✓                           | ✓                          | ✓                           | ✓                    | ✓           | ✓                       | ✓ / ✓                       | ✓                 | ✓                                        | —       | ✓            |
| **underwriter**        | ✓            | ✓                           | ✓                          | ✓                           | ✓                    | ✓           | ✓                       | R / —                       | —                 | —                                        | —       | —            |
| **loan_officer** (BDO) | ✓            | ✓ (create, intake edits)    | ✓                          | **—**                       | **—**                | ✓ (propose) | ✓                       | —                           | —                 | —                                        | —       | —            |
| **processor**          | ✓            | edit status/checklists only | ✓ (closing docs)           | —                           | —                    | R           | ✓                       | —                           | —                 | —                                        | —       | —            |
| **auditor**            | R            | —                           | —                          | R                           | R                    | R           | ✓ (read-only artifacts) | ✓ / ✓                       | R (roster)        | R                                        | —       | R            |
| **it_admin**           | **—**        | —                           | —                          | —                           | —                    | —           | —                       | R (auth/member events only) | ✓                 | ✓                                        | —       | ✓ (non-deal) |
| **viewer** (legacy)    | R            | —                           | —                          | R                           | R                    | R           | —                       | —                           | —                 | —                                        | —       | —            |
| **external**           | D            | —                           | D (upload to granted deal) | D (if grant says `decider`) | D (if `decider`)     | D (read)    | D                       | —                           | —                 | —                                        | —       | —            |

Matrix notes (the industry-shaped decisions):

- **loan_officer cannot decide facts** — the originator/decider separation is the credit-integrity line every SBA shop draws; it maps 1:1 onto the existing `facts.decide` = `underwriterProcedure` surface (`review.ts:68,95,161`, `source.ts:87,149`, `addbacks.ts:106,144`). An LO can _propose_ a loan scenario (`scenarios.write`) since structuring is origination work; the metrics it produces are engine output either way (iron law #3).
- **it_admin sees no deal data.** RLS simply grants it no `deals.read`; every deal-scoped table returns zero rows. This is the separation-of-duties answer banks' vendor-risk questionnaires ask for. It can read _member/security_ audit events only (filtered `audit.read` on `table_name in ('profiles','invites','deal_members','tenants')`). Flagged as open question §11.2 because small shops may want one hat.
- **auditor** is the SOC-2/FDIC-exam seat: read-everything (including review queue history and superseded facts — the append-mostly spine, `ARCHITECTURE.md:166`, is what makes this seat valuable), plus `audit.export`. Zero write capabilities of any kind.
- **processor** exists for the post-approval world (closing checklists arrive MVP 3–4); in MVP its distinct powers are small (status edits, closing-doc uploads, exports) but creating the enum value now costs nothing and avoids a second enum migration.
- **Deletes stay admin-tier** (`deals.delete`: org_owner/admin only), preserving `0001`'s delete floor.

---

## 3. Deal-level access

### 3.1 Model

Role gives the org-wide default; `deal_members` narrows or extends it:

```sql
create type deal_member_role as enum ('lead', 'member', 'viewer', 'decider');
-- 'decider' exists for external seats: grants facts.decide ON THIS DEAL only.

create table deal_members (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  deal_id     uuid not null references deals(id),
  user_id     uuid not null,                -- profiles.id; plain uuid like created_by (0002:5–6)
  deal_role   deal_member_role not null default 'member',
  granted_by  uuid,
  expires_at  timestamptz,                  -- external seats SHOULD set this
  revoked_at  timestamptz,                  -- append-mostly: revoke, never delete
  created_at  timestamptz not null default now(),
  unique (deal_id, user_id)
);
```

Two access modes, an org setting (`tenants.settings->>'deal_access_mode'`):

- **`open`** (default — today's behavior, `0001:96–97`): every internal role with `deals.read` sees every deal in the org. `deal_members` is then purely a _team roster_ (assignment UX, notifications, dashboard filters).
- **`team`**: non-admin internal users additionally need an unrevoked, unexpired `deal_members` row. Banks with information-barrier policies flip this on.

**`external` role users are ALWAYS grant-scoped regardless of mode** — that is the definition of the seat. The LSP underwriter working one deal = `profiles.role='external'` in the _host_ tenant + one `deal_members(deal_role='decider', expires_at=…)` row. This preserves the one-user-one-tenant invariant (§1.3): delegation is a seat in the data owner's org, never a cross-tenant read.

### 3.2 RLS helper

```sql
create or replace function public.can_access_deal(p_deal_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.current_user_role() = 'external' or
         (select coalesce(t.settings->>'deal_access_mode','open') from tenants t
           where t.id = public.current_tenant_id()) = 'team'
         and public.current_user_role() not in ('org_owner','admin','auditor')
    then exists (select 1 from public.deal_members dm
                  where dm.deal_id = p_deal_id and dm.user_id = auth.uid()
                    and dm.revoked_at is null
                    and (dm.expires_at is null or dm.expires_at > now()))
    else true
  end
$$;
```

Deal-scoped select policies gain one conjunct: `using (tenant_id = current_tenant_id() and role_can('deals.read') and can_access_deal(deal_id))`. Every deal-scoped table already carries `deal_id` (facts `0000:187`, documents `0000:117`, addbacks, issues, loan_scenarios, computed_metrics, extraction_runs, logical_documents via document — **except `periods` and `pages`**, which reach the deal via `entity_id`/`logical_document_id` (`0000:103–112, 142–149`). Rather than join inside a hot RLS predicate, add denormalized `periods.deal_id` and `pages.deal_id` columns (additive, backfilled — §9 step 3). Composite indexes `(deal_id, user_id) `on `deal_members` keep the EXISTS cheap; in `open` mode the function short-circuits before touching the table, so **default-mode performance is unchanged from today**.

`facts.decide`-tier mutations for externals: tRPC checks `role_can('facts.decide') OR (role='external' AND deal grant is 'decider')`; the RLS insert/update policies mirror it (`role_can('facts.decide') or public.deal_grant_role(deal_id) = 'decider'` via a sibling helper). Audit triggers (`0004`) already record the actor uid on every such write — external decisions are automatically attributable, which is the whole point of giving them a real seat instead of a shared login.

---

## 4. Invites & onboarding

Constraint that shapes everything: **no service-role key in request paths** (iron law #7; `0001:11–13`). Supabase's `auth.admin.inviteUserByEmail` requires the admin API, so we don't use it in-path. Instead invites are **claims, not accounts**: the invitee authenticates themself (email/password or Google — both already wired, `environments.md:71–86`), and a SECURITY DEFINER function converts a matching pending invite into a `profiles` row. No admin API anywhere.

```sql
create table invites (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  email        text not null,                  -- lowercased
  role         user_role not null,
  deal_id      uuid references deals(id),      -- REQUIRED when role='external'
  deal_role    deal_member_role,               -- for the auto-created grant
  token_hash   text not null,                  -- sha256 of the URL token; raw token never stored
  invited_by   uuid not null,
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint invites_external_needs_deal check (role <> 'external' or deal_id is not null)
);
```

**Flows:**

1. **Owner bootstrap (org signup).** New signup has no profile → today they're dead-ended (`environments.md:73–77`). Add `create_organization(p_name text, p_kind org_kind)` SECURITY DEFINER: asserts `auth.uid()` has no `profiles` row, inserts `tenants` + `profiles(role='org_owner')` atomically. Exposed as `org.create` tRPC mutation behind a `/welcome` page. Solo-broker default: name prefilled from auth metadata, `kind='solo_broker'`.
2. **Member invite.** `members.manage` holder calls `invites.create` → server generates token, stores hash, emails link `/invite/accept?token=…` (transactional email; Supabase SMTP or Resend-class — the mail contains only the token, no PII beyond org name). Escalation guard: nobody grants a role above their own tier; only `org_owner` can mint `org_owner` (and doing so is ownership _transfer_, a distinct two-step confirm).
3. **Accept.** Middleware sends unauthenticated visitors to login/signup first (add `/signup` to `PUBLIC_PATHS`, `middleware.ts:9`; `/invite/accept` stays gated). Signed in, the page calls `invites.accept(token)` → `accept_invite(p_token)` SECURITY DEFINER: hash-match, unexpired, unrevoked, **JWT email must equal invite email** (case-insensitive), caller has no profile → insert `profiles` row (+ `deal_members` row when external), stamp `accepted_at`. Audit triggers on `profiles`/`invites`/`deal_members` (§9 step 4) record the whole chain.
4. **Revoke / expire.** `invites.revoke` sets `revoked_at` (append-mostly, no deletes). Member offboarding = `profiles.status='deactivated'` (new column) — RLS helpers return NULL tenant for deactivated profiles, killing access instantly without destroying `created_by` lineage; the auth user is _not_ deleted (the `ON DELETE CASCADE` on `0002:15` makes user-deletion equal profile-deletion, which would orphan audit attribution — so we never delete, we deactivate).
5. **SSO/SAML — MVP 4 seam only** (per `ROADMAP.md:124`): note-level design — WorkOS-class IdP in front of Supabase OIDC; schema seam is `tenants.settings->'sso'` (connection id, enforced-domain list) and `invites` becoming optional under JIT provisioning gated on verified domain. No columns beyond `settings` needed now.

---

## 5. Account & org surface (UI inventory)

Existing app surface for placement context: `/` dashboard, `/costs`, `/deals/[dealId]/{documents,assignment,review,workspace}` (`apps/web/src/app/…`), login at `/login`, auth callbacks under `/auth/*`.

| Route                                  | Who                                               | Contents                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/welcome`                             | signed-in, no profile                             | Org bootstrap: create org (owner path) or "ask your admin for an invite" (dead-end today per `environments.md:73–77` — this page replaces the dead end)                                                                                       |
| `/signup`                              | public (add to `PUBLIC_PATHS`, `middleware.ts:9`) | Email/password + Google signup                                                                                                                                                                                                                |
| `/invite/accept`                       | signed-in                                         | Token claim → `invites.accept`                                                                                                                                                                                                                |
| `/settings/profile`                    | any member                                        | Name; email change via `supabase.auth.updateUser({email})` (Supabase double-confirmation flow); avatar later                                                                                                                                  |
| `/settings/security`                   | any member                                        | Password change; password reset request (`resetPasswordForEmail` → `/auth/reset` callback); **MFA/TOTP enroll** (Supabase MFA API: enroll → QR → challenge/verify; factor list + unenroll)                                                    |
| `/settings/sessions`                   | any member                                        | "Sign out other sessions" (`auth.signOut({scope:'others'})` — available without admin API). Full session _inventory_ (device, IP, last-seen) requires the auth admin API and therefore cannot run in a request path — see open question §11.5 |
| `/org/members`                         | `members.manage` (+ read for auditor)             | Roster, role changes (audited), deactivate; external seats listed with their deal + expiry                                                                                                                                                    |
| `/org/invites`                         | `members.manage`                                  | Pending/expired/revoked invites, resend, revoke                                                                                                                                                                                               |
| `/org/settings`                        | `org.settings`                                    | Org name/kind, `deal_access_mode`, `require_mfa` toggle, retention window (seam), SSO (MVP 4 placeholder)                                                                                                                                     |
| `/org/audit`                           | `audit.read`                                      | Filterable audit-log viewer over `audit_log` (`0000:248–258`); CSV export behind `audit.export`, export action itself audited                                                                                                                 |
| `/deals/[dealId]/team` (workspace tab) | deal-visible members                              | Deal team roster; grant/revoke (`members.manage` or deal `lead`); external-collaborator invite entry point                                                                                                                                    |

MFA enforcement: org setting `require_mfa=true` → middleware (`middleware.ts:22`) additionally checks the session's AAL claim (`aal2`) for non-public paths and redirects to `/settings/security?enroll=1`. Banks will ask; TOTP-only for MVP (WebAuthn later).

---

## 6. Schema DDL sketch (consolidated)

Drizzle-migration style, matching repo convention (`packages/schema/drizzle/*.sql`; TS mirrors land in `packages/schema` in the same PR — iron law #10):

```sql
-- (a) enums: extend in place; new values usable only in LATER migration files
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'org_owner';      --> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'loan_officer';   --> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'processor';      --> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'auditor';        --> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'it_admin';       --> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'external';       --> statement-breakpoint
CREATE TYPE "public"."org_kind" AS ENUM('lender','broker_firm','solo_broker'); --> statement-breakpoint
CREATE TYPE "public"."profile_status" AS ENUM('active','deactivated');    --> statement-breakpoint
CREATE TYPE "public"."deal_member_role" AS ENUM('lead','member','viewer','decider');

-- (b) org columns (additive; defaults preserve current behavior)
ALTER TABLE "tenants" ADD COLUMN "kind" "org_kind" DEFAULT 'lender' NOT NULL;
ALTER TABLE "tenants" ADD COLUMN "parent_tenant_id" uuid REFERENCES "tenants"("id");  -- MVP4 seam, §1.2
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_no_self_parent" CHECK (parent_tenant_id IS DISTINCT FROM id);
ALTER TABLE "tenants" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;
       -- keys: deal_access_mode ('open'|'team', default open), require_mfa (bool), sso (MVP4)

-- (c) profile lifecycle
ALTER TABLE "profiles" ADD COLUMN "status" "profile_status" DEFAULT 'active' NOT NULL;
ALTER TABLE "profiles" ADD COLUMN "updated_at" timestamptz DEFAULT now() NOT NULL;

-- (d) role_capabilities + seed  (§2.2)   -- matrix-as-data, one place
-- (e) deal_members                (§3.1)
-- (f) invites                     (§4)
-- (g) helper functions: role_can(cap), can_access_deal(deal_id), deal_grant_role(deal_id),
--     create_organization(name, kind), accept_invite(token)   -- all SECURITY DEFINER,
--     search_path pinned, EXECUTE revoked from public/anon, granted to authenticated
--     (same hygiene as 0001:34–37)
-- (h) current_tenant_id()/current_user_role() gain "and status = 'active'" (deactivation kill-switch)
```

---

## 7. RLS policy sketches

```sql
-- New tables
ALTER TABLE deal_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY deal_members_select ON deal_members FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id()
         AND (user_id = auth.uid() OR role_can('members.manage') OR role_can('audit.read')));
CREATE POLICY deal_members_insert ON deal_members FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id()
              AND (role_can('members.manage') OR deal_grant_role(deal_id) = 'lead'));
CREATE POLICY deal_members_update ON deal_members FOR UPDATE TO authenticated  -- revoke/extend only
  USING (tenant_id = current_tenant_id() AND role_can('members.manage'))
  WITH CHECK (tenant_id = current_tenant_id());
-- no DELETE policy: revocation only (append-mostly)

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY invites_select ON invites FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND role_can('members.manage'));
CREATE POLICY invites_insert ON invites FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND role_can('members.manage'));
CREATE POLICY invites_update ON invites FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND role_can('members.manage'))
  WITH CHECK (tenant_id = current_tenant_id());
-- acceptance happens inside accept_invite() (definer), not via this policy

-- profiles graduates from select-only (0001:85–86):
CREATE POLICY profiles_update_self ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid())
              AND tenant_id = current_tenant_id() AND status = 'active');
              -- self-edit of name only; role/tenant/status pinned — no self-escalation
CREATE POLICY profiles_update_admin ON profiles FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND role_can('members.manage') AND id <> auth.uid())
  WITH CHECK (tenant_id = current_tenant_id()
              AND (role <> 'org_owner' OR current_user_role() = 'org_owner'));
-- INSERT remains function-only (create_organization / accept_invite) — no insert policy.

-- The floor pattern swap (per deal-scoped table; behavior-preserving for legacy roles):
--   select:  tenant_id = current_tenant_id() AND role_can('deals.read') AND can_access_deal(deal_id)
--   ins/upd: … AND role_can('<table cap>') OR (role='external' AND deal_grant_role(deal_id)='decider')
--   delete:  … AND role_can('deals.delete')
-- audit_log select splits: role_can('audit.read') full; it_admin filtered to member/security tables.
-- Storage (0003:36–58): insert predicate role list → role_can('documents.upload');
--   select gains a deal check only in 'team' mode (path already encodes deal_id segment 3).

-- Audit coverage extension (bank requirement — membership changes are auditable events):
CREATE TRIGGER profiles_audit     AFTER INSERT OR UPDATE OR DELETE ON profiles     FOR EACH ROW EXECUTE FUNCTION audit_record();
CREATE TRIGGER deal_members_audit AFTER INSERT OR UPDATE OR DELETE ON deal_members FOR EACH ROW EXECUTE FUNCTION audit_record();
CREATE TRIGGER invites_audit      AFTER INSERT OR UPDATE OR DELETE ON invites      FOR EACH ROW EXECUTE FUNCTION audit_record();
CREATE TRIGGER tenants_audit      AFTER UPDATE ON tenants                          FOR EACH ROW EXECUTE FUNCTION audit_record();
-- note: audit_record() reads new.tenant_id (0004:26); tenants trigger needs a thin wrapper mapping id→tenant_id.
-- invites.token_hash should be redacted by that wrapper before to_jsonb lands in audit_log.
```

`credexis_worker` (`0001:297–344`) is untouched: it never reads profiles/invites/deal_members and its table-scoped policies don't reference `current_user_role()`.

---

## 8. tRPC router surface

`init.ts` grows a capability builder; the existing exports become thin aliases so `authz.test.ts` and every router keep compiling and passing:

```ts
// init.ts additions
export const requireCap = (cap: Capability) =>
  protectedProcedure.use(/* ctx.capabilities.has(cap) */);
// underwriterProcedure ≡ requireCap('facts.decide')  — same accepts/rejects for admin/underwriter/viewer
// adminProcedure       ≡ requireCap('org.settings')
// context.ts: Profile gains { role: UserRole; status; capabilities: Set<Capability> }
//   (capabilities loaded from role_capabilities in the same RLS-scoped round trip)
// NEW: dealScopedProcedure(input: {dealId}) — asserts can_access_deal server-side too
//   (defense in depth; RLS remains the floor). External 'decider' passes facts.decide
//   checks only through this builder.
```

New routers (added to `router.ts:19–65` alongside the existing thirteen):

```
org.create({name, kind})                       protected (no-profile only)   → bootstrap §4.1
org.get / org.update({name, kind, settings})   protected / requireCap('org.settings')
org.members.list                               protected (roster visibility per §7)
org.members.setRole({userId, role})            requireCap('members.manage') + tier guard
org.members.deactivate({userId})               requireCap('members.manage')
org.transferOwnership({toUserId})              org_owner only, two-step confirm
invites.create({email, role, dealId?, dealRole?, expiresAt?})  requireCap('members.manage')
invites.list / invites.revoke({id}) / invites.resend({id})     requireCap('members.manage')
invites.accept({token})                        protected (profile-less callers allowed)
dealTeam.list({dealId})                        dealScopedProcedure
dealTeam.grant({dealId, userId, dealRole, expiresAt?})   requireCap('members.manage') | deal lead
dealTeam.revoke({dealId, userId})              requireCap('members.manage') | deal lead
account.updateProfile({fullName})              protected
account.mfa.status                             protected  (factor list via user-scoped auth API)
account.sessions.revokeOthers                  protected  (auth.signOut scope:'others')
audit.list({filters, cursor})                  requireCap('audit.read')
audit.export({filters})                        requireCap('audit.export')  (export itself audited)
```

Existing routers change **only** their builder where the matrix narrows: e.g. `deals.create` (`deals.ts:86`) moves `underwriterProcedure → requireCap('deals.create')` (now also loan_officer); `documents` upload path gains `documents.upload` (loan_officer, processor); `review/source/addbacks` mutations stay on `facts.decide` exactly as today.

---

## 9. Migration & rollout order (additive; nothing breaks between steps)

Numbered to follow `0009_registry-only-facts.sql`. Each step deploys independently; the app runs correctly at every intermediate point.

1. **`0010_org-enums.sql`** — §6(a)+(b)+(c): enum values, `tenants.kind/parent_tenant_id/settings`, `profiles.status/updated_at`. Pure additive; no policy references new values yet; every existing query/test unaffected (defaults preserve behavior).
2. **`0011_role-capabilities.sql`** — `role_capabilities` + seed for **all nine roles including legacy three** (admin/underwriter/viewer rows encode exactly today's `0001` semantics), `role_can()`, `deal_members`, `invites`, their RLS + indexes, audit triggers §7, `current_*()` helpers gain the `status='active'` conjunct. Old policies still in force — the capability layer is live but unused by RLS.
3. **`0012_deal-scope-columns.sql`** — add + backfill `periods.deal_id`, `pages.deal_id` (from `entities`/`logical_documents`→`documents`); `can_access_deal()`, `deal_grant_role()`. Backfill is a single UPDATE per table inside the migration; worker insert paths updated in the same PR (iron law #10).
4. **`0013_policy-capability-swap.sql`** — drop/recreate the tenant-table policies replacing `current_user_role() in ('admin','underwriter')` predicates (`0001`, `0003:49`, `0007:28,33`) with `role_can(...)` + `can_access_deal(...)`. **Provably behavior-preserving for existing data:** legacy roles' capability rows reproduce the old truth table, and `deal_access_mode` defaults to `open` with zero `external` profiles existing, so `can_access_deal()` short-circuits true. The M6.6 live e2e (`environments.md:120–124`) and RLS integration tests run green before/after — that equivalence is the step's acceptance gate.
5. **`0014_org-functions.sql`** — `create_organization`, `accept_invite`, profiles update policies (§7). App ships `/welcome`, `/signup`, `/invite/accept`, `/settings/*`, `/org/*`, new routers, `requireCap` builders (aliases keep `authz.test.ts` passing; new fabricated-context tests cover the six new roles' accept/reject table).
6. **Backfill decision [PRATIK]** — optionally promote one `admin` per existing tenant to `org_owner` (data update, not schema). Until then, `admin` retains member management, so no org is bricked.
7. **MFA enforcement + sessions UI** — org toggle, middleware AAL check, revoke-others. Independent of 1–6.
8. **MVP 4 (explicitly out of scope now)** — LSP traversal policies over `parent_tenant_id`, WorkOS SSO, JIT provisioning.

Rollback story: steps 1–3 are inert additions; step 4 is the only behavioral surface, and its rollback is re-applying the `0001` policy set (kept as a down-script alongside the migration).

---

## 10. What deliberately does NOT change

- `current_tenant_id()` stays the single tenancy root (`0001:18–24`) — every existing policy, the storage key scheme, and `learned_mappings` scoping keep working untouched.
- The `credexis_worker` posture (`0001:297–344`) and audit-writer mechanism (`0004`) are extended, never modified.
- The borrower portal (MVP 3, `ROADMAP.md:123`) remains a **separate auth surface** (`apps/portal`, magic links, upload-only role) — borrowers are _not_ org members and get no `user_role`; keeping them out of this model is a design decision, not an omission.
- Client renders, never computes (iron law #3): capability sets ship to the client for UI affordance only; every enforcement point is tRPC middleware + RLS.

## 11. Open questions

1. **Multi-org membership** (one human, several institutions): punted via §1.3's one-seat-per-org stance. If MVP 4 LSP work demands true multi-org identity, the change is a `memberships(user_id, tenant_id, role)` table replacing profiles-as-membership + a JWT-claim-selected active tenant in `current_tenant_id()` — a large, but contained, rework. Decide when LSP contracts are real.
2. **it_admin data blindness**: is zero deal access right for 5-person shops, or should `it_admin` be a _modifier_ on another role? Validate with the first bank design partner's vendor-risk questionnaire.
3. **org_owner backfill**: promote earliest admin per existing tenant automatically, or leave to manual choice? [PRATIK]
4. **Default `deal_access_mode` by org kind**: `open` for brokers is clearly right; should `kind='lender'` default to `team`? Leaning yes at org creation time only (never retroactively).
5. **Session inventory**: full device/IP session lists require the Supabase auth admin API (service-role) — forbidden in request paths. Options: (a) ship revoke-others only (MVP recommendation); (b) a scheduled Trigger.dev job syncing `auth.sessions` metadata into a tenant-scoped read model (out-of-request, worker-role pattern). Decide when a bank asks.
6. **MFA scope**: TOTP-only at first; is org-level `require_mfa` with a 7-day grace window sufficient for pilots, or do banks require enforced-at-invite?
7. **External seat guardrails**: mandatory `expires_at`? Domain allowlists per org? NDA acknowledgment checkbox recorded in audit?
8. **`viewer` retirement**: after auditor exists, migrate remaining viewers and drop the value from the seed matrix (enum value itself is harmless to leave).
9. **`processor` capability breadth in MVP**: near-underwriter-read today; revisit when closing checklists (MVP 3–4) define its write surface.
10. **Billing seam**: matrix reserves `billing.manage` for org_owner; actual billing tables/Stripe linkage are unscoped here — needs its own brief before pricing tiers (`docs/PRICING-STRATEGY.md`) go live.

---

Key files cited: `/Users/ghostface/Credexis/packages/schema/drizzle/0000_schema-v1.sql`, `0001_rls-v1.sql`, `0002_auth-wiring.sql`, `0003_storage-layout.sql`, `0004_audit-writer.sql`, `0005_assignment-audit.sql`, `0007_transcripts.sql`, `/Users/ghostface/Credexis/apps/web/src/middleware.ts`, `/Users/ghostface/Credexis/apps/web/src/server/trpc/{init.ts,context.ts,router.ts,authz.test.ts}`, `/Users/ghostface/Credexis/apps/web/src/server/trpc/routers/*.ts`, `/Users/ghostface/Credexis/docs/{ARCHITECTURE.md,environments.md,ROADMAP.md}`.
