# Borrower Portal — Build Plan (M12.1)

**Status: APPROVED FOR BUILD.** Supersedes the borrower-portal sections of
`02-borrower-notifications-validation.md` §§1.1–1.6 (that design's B2/B3
defects are fixed here; its §1.4 policy sketch is **void**). Binding against
`00-SYNTHESIS.md` §"Borrower portal" and `04-adversarial-review.md` B1–B4 +
Advisories 1–9 + GAP 1–10.
Date: 2026-07-29 · Owner: Pratik (CEO) · Architect: Claude (CTO seat).

Grounded in (read, not inferred): `0001_rls-v1.sql`, `0002_auth-wiring.sql`,
`0003_storage-layout.sql`, `0004_audit-writer.sql`, `0011_org-functions.sql`,
`0013_invites-rls.sql`, `0015_notifications-rls.sql`, `0021`/`0022` (quota +
spend), `0024_audit-hash-chain.sql`, `packages/schema/src/db/{tenancy,documents,deals,enums}.ts`,
`packages/schema/src/rls/{harness.ts,shim.sql,rls-harness.test.ts}`,
`apps/web/src/app/api/upload/route.ts`, `apps/web/src/middleware.ts`,
`apps/web/src/server/trpc/init.ts`, `apps/web/src/lib/{storage,doc-checklist}.ts`,
`packages/pipeline/src/{ingest.ts,ports.ts,supabase.ts,trigger/ingest-document.ts}`,
`packages/shared/src/limits.ts`.

---

## 0. The decision, in one paragraph

**Spine: the no-profile / invite-bound identity model.** A borrower is an
`auth.users` row with **no `profiles` row, ever**. Their entire authority is
`borrower_invites.auth_user_id = auth.uid()`. They match **exactly two RLS
policies in the whole database, both on `storage.objects`**, and **zero
policies in the `public` schema** — every read they perform goes through four
`SECURITY DEFINER` functions that re-derive the invite from `auth.uid()` and
take no tenant or deal id from the caller. Grafted onto that spine from the
competing designs: the separate `apps/portal` deployment, snapshot labels on
the invite, a broker-editable checklist snapshot, and the curated coarse
status. Rejected outright: any borrower `documents` INSERT/SELECT policy, any
deal-wide (`invite_id IS NULL`) request row, and any `anon`-granted database
function.

Three things in this plan are **better than all three input designs** and are
called out where they appear: (1) the magic-link flow needs **no `anon` grant
at all** (§3.3), (2) **storage-object flooding** is closed by a budget
predicate in the INSERT policy, not just a `documents`-row quota (§5.3), and
(3) the **per-invite extraction cost ceiling** is designed in rather than
accepted as a risk (§7.2).

---

## 1. The central tension, resolved

`current_tenant_id()` (0011) is:

```sql
select tenant_id from public.profiles where id = auth.uid() and status = 'active'
```

Every tenant policy in the system is `tenant_id = public.current_tenant_id()`.
So **any `profiles` row grants tenant-wide read** across `deals`, `documents`,
`facts`, `computed_metrics`, `issues`, everything. A borrower who gets a
profile is a borrower who can read the lender's whole book.

### 1.1 Why not the alternative spines

| Spine                                                                   | What breaks                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B — `profiles` row with `role = 'borrower'`** (tier 0 in `role_tier`) | Requires editing **every** existing tenant policy to add `role_tier(...) >= 1`. That is the 50-policy drop/recreate the adversarial review explicitly **CUT** (04 §CUT/A). One missed policy is a full-tenant leak, and the failure is silent. Also poisons `notify_tier` fan-out, `profiles_select_same_tenant` (borrower emails become visible to each other), and the deactivation kill-switch semantics. |
| **C — custom JWT claims (`invite_id` in `app_metadata`)**               | Claims are minted at token issuance and live until refresh; revocation stops being immediate. Needs a service-role admin call to set claims — in a request path, i.e. an Iron Law #7 violation.                                                                                                                                                                                                              |
| **A — no profile, invite-bound (CHOSEN)**                               | Costs: four reference-table policies must be tightened (§4.2), and a **disjointness invariant** must be enforced (§1.3). Both are bounded, enumerable, and provable by the harness.                                                                                                                                                                                                                          |

Spine A is also what the database already documents: `0002_auth-wiring.sql`
states verbatim that signed-in users without a profile "get nothing — every
RLS policy resolves `current_tenant_id()` to NULL for them, which matches no
rows." We are not inventing a posture; we are honouring one and closing the
four places it was never actually true.

### 1.2 What happens to every existing policy keyed on `current_tenant_id()`

**Nothing. They are unchanged and vacuously false for borrowers.** For a
borrower, `current_tenant_id()` is NULL, so `tenant_id = NULL` → NULL → not
TRUE → row denied. Complete list, verified against `0001`/`0003`/`0011`/
`0013`/`0015`/`0017`: `tenants_select_own`, `profiles_select_same_tenant`,
`profiles_update_manage`, `deals_{select,insert,update,delete}`,
`entities_*`, `periods_*`, `documents_*`, `logical_documents_*`, `pages_*`,
`facts_*`, `extraction_runs_*`, `addbacks_*`, `loan_scenarios_*`,
`computed_metrics_select`, `issues_*`, `audit_log_select`, `invites_*`,
`notifications_{select,update}_own`, `document_identities_*`, and
`deal_documents_tenant_{select,insert,delete}` on `storage.objects`.

Zero of them are edited by this plan. That is the entire argument for the
spine.

### 1.3 The disjointness invariant (what makes the above _provable_)

An `auth.users` row is an **org member** (has `profiles`) **XOR** a
**borrower** (has ≥1 `borrower_invites.auth_user_id = uid`). Enforced in
three definers in migration `0026`:

- `claim_borrower_invite(text)` raises if a `profiles` row exists for the caller.
- `create_organization(text, org_kind)` — `CREATE OR REPLACE`, adds a raise if
  the caller holds any borrower invite (otherwise a borrower self-serves a
  tenant at `/welcome` and becomes dual-class).
- `accept_invite(text)` — same borrower guard.

Consequence: no `auth.uid()` ever satisfies both `current_tenant_id() IS NOT
NULL` and `has_borrower_invite()`. Therefore the two new storage policies are
**vacuously FALSE for every org user** — the org's storage reach is
byte-identical to today — and every existing policy is vacuously false for
every borrower. Harness scenarios B-17/B-18/B-19 pin it.

### 1.4 What a borrower can reach, exhaustively

| Surface                | Reach                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `public` schema tables | **none** — no policy grants them a single row anywhere                                                                                     |
| `storage.objects`      | INSERT + SELECT under `<their tenant>/deals/<their deal>/borrower-uploads/<their invite>/` only. No UPDATE, no DELETE                      |
| Functions              | `claim_borrower_invite`, `borrower_portal_state`, `borrower_attach_upload`, `current_invite_ids` — all derive the invite from `auth.uid()` |
| Notifications          | structurally impossible: `notifications.recipient_id` FKs `profiles.id`                                                                    |

---

## 2. Attack ledger

Every critical/major finding is either **designed out** (D) or **accepted with
a stated mitigation** (A). Sources: `04-adversarial-review.md` (B1–B4,
Advisories), the three candidate designs' own risk lists, and this review pass.

| #       | Sev                      | Attack                                                                                                                                                                                                                                                                                       | Verdict                                                                                                                                                                                                                                                                                                                            |
| ------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1      | **critical**             | Borrower calls `notify()` via PostgREST with arbitrary title/body/action_url into bank staff's bell                                                                                                                                                                                          | **D** — `notify_tier` stays revoked from `authenticated` (0015). Borrower fan-out is an AFTER INSERT trigger (`notify_borrower_upload`, §6.5) whose title is a fixed literal and whose body is composed only from broker-authored strings. Not even the filename reaches the card. Dedupe key caps at one card per invite per hour |
| B2      | **critical**             | Borrower inserts a `documents` row whose `storage_path` points at another tenant's object; the service-role worker ingests it                                                                                                                                                                | **D** — three layers: (i) there is **no borrower INSERT policy on `documents`** at all; (ii) `documents_invite_path_guard` is a BEFORE INSERT/UPDATE **trigger**, so it binds the client, the definer, the service-role worker and `postgres` alike (§6.4); (iii) `runIngest` asserts the prefix before `storage.download` (§8.1)  |
| B3      | **critical**             | Storage policy off-by-one; the deal segment is never validated against the invite                                                                                                                                                                                                            | **D** — `borrower_upload_key_ok()` splits on `/`, requires **exactly 6 elements**, pins segments 1/3/5 to `invite.tenant_id`/`deal_id`/`id` as **text** and 2/4 to literals (§5.2). Harness B-08 is the explicit off-by-one regression test                                                                                        |
| B2-tail | **major**                | `documents_deal_sha256_unique(deal_id, sha256)` is a hash-existence oracle across principals and lets a borrower squat a digest to block a future org upload                                                                                                                                 | **D** — uniqueness re-scoped to the **writer**: `(deal_id, sha256, coalesce(uploaded_via_invite_id, nil-uuid))`. The portal never returns a "duplicate" distinguishable from a "new" response (§6.6). Cost (duplicate extraction spend) mitigated by the worker duplicate-gate (§8.3)                                              |
| B4      | **major**                | Worker posture fiction (`current_user = 'credexis_worker'` inside a definer)                                                                                                                                                                                                                 | **D** — no new worker role. Pipeline writes stay service-role-with-explicit-tenant-checks; borrower fan-out is a trigger, not a worker RPC                                                                                                                                                                                         |
| A-1     | **critical**             | Underwriter does `UPDATE borrower_invites SET auth_user_id = <own uid>` via PostgREST and mints themself a borrower binding on any deal                                                                                                                                                      | **D** — RLS cannot restrict columns, so `REVOKE UPDATE … FROM authenticated` + column-scoped `GRANT UPDATE (…)` (the 0019 pattern), plus `borrower_invites_guard` blocking hand-activation and terminal-state resurrection (§6.2)                                                                                                  |
| A-2     | **major**                | `documents_borrower_select_own USING (uploaded_by = auth.uid())` (design 02 §1.4) **widens an existing guarantee**: a _deactivated_ org member has `current_tenant_id() = NULL` but still satisfies `uploaded_by = auth.uid()`, silently exempting their documents from the 0011 kill-switch | **D** — that policy is deleted from the design. Borrowers get **no** `documents` SELECT policy; the portal reads through `borrower_portal_state()`                                                                                                                                                                                 |
| A-3     | **major**                | Reference tables (`taxonomy_nodes`, `form_registry`, `policy_packs`) are `USING (true)` and `learned_mappings` has a `tenant_id IS NULL` branch → a borrower reads the SBA policy pack, the whole form registry, and global mappings                                                         | **D** — all four tightened to require `current_tenant_id() IS NOT NULL` (§4.2). Verified no pre-profile bootstrap path reads them (every caller is behind `protectedProcedure`)                                                                                                                                                    |
| A-4     | **critical**             | Invite minted with `deal_id` belonging to another tenant (uuid guess) → cross-tenant document rows                                                                                                                                                                                           | **D** — `borrower_invites_insert` WITH CHECK requires `deal_id IN (SELECT id FROM public.deals)` (RLS-filtered to the caller's tenant) and, when present, `entity_id` to belong to that deal                                                                                                                                       |
| A-5     | **major**                | Borrower floods the bucket with 50 MiB objects that never become `documents` rows, evading the row-based quota entirely                                                                                                                                                                      | **D** — `borrower_object_budget_ok(name)` counts objects already under the invite prefix inside the **INSERT policy** (§5.3). This hole existed in all three input designs                                                                                                                                                         |
| A-6     | **major**                | Borrower understates `bytes` to evade quotas by inserting `documents` directly                                                                                                                                                                                                               | **D** — no INSERT policy; `borrower_attach_upload` reads the authoritative size from `storage.objects.metadata` and never trusts a caller-supplied size                                                                                                                                                                            |
| Adv-3   | **major**                | `borrower_portal_state(p_invite, families jsonb)` turns the checklist into a **deal-composition oracle** — a borrower probes which form families exist on the deal, including other guarantors' filings                                                                                      | **D** — the definer takes **no arguments**. Item satisfaction is computed **only over `documents.uploaded_via_invite_id = <this invite>`**; an org-side or co-guarantor upload never ticks the borrower's box                                                                                                                      |
| A-7     | **major**                | Malformed path segment `::uuid` cast raises inside a policy → error-message oracle + DoS                                                                                                                                                                                                     | **D** — comparisons are always `uuid::text = segment`, never `segment::uuid`                                                                                                                                                                                                                                                       |
| A-8     | **major**                | Path traversal / extra segments (`a/deals/b/borrower-uploads/c/../../x.pdf`)                                                                                                                                                                                                                 | **D** — exact element count 6 + leaf regex `^[0-9a-f]{64}\.(pdf\|png\|jpg\|tif\|xlsx\|xls)$`                                                                                                                                                                                                                                       |
| Adv-7   | **major**                | Leaked portal env triggers arbitrary Trigger.dev tasks                                                                                                                                                                                                                                       | **D** — the portal holds a token scoped to `ingest-document` only. Ship gate on PR 6                                                                                                                                                                                                                                               |
| GAP-9   | **major**                | Internet-facing uploads reach a paid extractor unscanned                                                                                                                                                                                                                                     | **D** — `runIngest` throws for borrower-originated documents when no scanner is wired or the verdict is not `clean`; the row-level `virus_scan='clean'` lock at extraction (already live, `ingest-document.ts:214`) is the second lock                                                                                             |
| Adv-6   | ~~major~~ **closed**     | Ship gates could not run: Actions billing blocked, Anthropic credits exhausted                                                                                                                                                                                                               | **RESOLVED 2026-07-29** — billing added, credits topped up, CI matrix consolidated. The gate on PR 6 stands as a rule; the blocker is gone                                                                                                                                                                                         |
| GAP-8   | **major**                | Supabase/Trigger/Azure keys pending rotation                                                                                                                                                                                                                                                 | **A** — hard gate: rotation completes **before PR 6 deploys**, i.e. before any real borrower byte exists. Pratik decision D-5                                                                                                                                                                                                      |
| R-1     | **major**                | An `anon`-granted definer that _writes_ (OTP rate-limit counters) cracks 0001's "anon gets nothing"                                                                                                                                                                                          | **D** — eliminated entirely. The claim flow needs **no** `anon` database grant (§3.3). This is the single biggest improvement over the input designs                                                                                                                                                                               |
| R-2     | **major**                | Portal session lifetime is enforced in app middleware, bypassable by talking to PostgREST/Storage directly with a valid refresh token                                                                                                                                                        | **A** — Supabase JWT lifetimes are project-global; shortening them shortens bankers' too. What actually bounds a stolen session is `expires_at` on the invite plus per-statement re-checks of `status`/`revoked_at`/`expires_at` in every helper. Clean fix (a second Supabase project for the portal) is Pratik decision D-2      |
| R-3     | **major**                | `borrower_attach_upload` depends on `storage.objects.metadata->>'size'` being populated by the Supabase storage service                                                                                                                                                                      | **A** — fails **closed** (`raise exception 'upload not finalized'`) rather than falling back to a caller-supplied size. A **live smoke test against a real Supabase project is a named ship gate on PR 6**; the harness proves the SQL, not the platform                                                                           |
| R-4     | **major**                | Scoping the sha256 index means identical bytes can exist twice on a deal → duplicate logical documents and duplicate extraction spend                                                                                                                                                        | **A→D(partial)** — the worker duplicate-gate (§8.3) withholds extraction when a byte-identical `processed` document already exists on the deal, at cost 0. Residual: a second `documents` row and a "duplicate of _file_" hint in the broker UI. Accepted                                                                          |
| R-5     | **major**                | One hostile invite exhausts the deal's `maxCostMicroUsdPerDeal` envelope and blocks the broker's own uploads                                                                                                                                                                                 | **D** — per-invite cost ceiling: `invite_extraction_spend(uuid)` + `borrower_invites.max_cost_micro_usd`, checked at the same point as the deal ceiling (§7.2). Designed out rather than accepted                                                                                                                                  |
| R-6     | **minor→major-if-wrong** | `(SELECT has_borrower_invite())` relies on the planner hoisting to an InitPlan; if it ever fails to hoist, an org user listing thousands of page-render objects pays a plpgsql call per row                                                                                                  | **A** — measure, don't assume (same worry as Advisory 1 on `can_access_deal()`). PR 2 ships an `EXPLAIN (ANALYZE)` note in the description showing one InitPlan evaluation for an org-user storage listing; a regression here is a perf bug, not a security bug                                                                    |
| R-7     | **minor**                | Two BEFORE triggers + two advisory locks now run on every `documents` INSERT, org uploads included                                                                                                                                                                                           | **A** — lock order is fixed (deal lock first, then invite lock) so it is deadlock-free; different deals still parallelize                                                                                                                                                                                                          |
| R-8     | **minor**                | Disjointness blocks a solo broker who is also a guarantor on their own deal from using the portal with the same email                                                                                                                                                                        | **A** — documented product limit; the workaround is a second email. Pratik decision D-4                                                                                                                                                                                                                                            |
| R-9     | **minor**                | Open magic-link sending (no invite pre-check) lets someone with a leaked link email-bomb third parties and inflate `auth.users`                                                                                                                                                              | **A** — bounded by portal middleware rate limit (5 claim-starts/hour/IP), Supabase's own auth rate limits, and the fact that a created `auth.users` row with no profile and no invite grants **nothing**. Turnstile/hCaptcha on the claim form is Pratik decision D-3                                                              |
| R-10    | **minor**                | Borrower uploads bytes X at key `sha256(Y)` by talking to the Storage API directly                                                                                                                                                                                                           | **A** — `runIngest`'s existing integrity check (`digest !== doc.sha256`) fails the document before the scanner and before any vendor spend. Cost is one download's bandwidth                                                                                                                                                       |

---

## 3. Identity & auth

### 3.1 Table binding

Authority = `borrower_invites.auth_user_id = auth.uid()` on an invite that is
`status='active'`, `revoked_at IS NULL`, `expires_at > now()`. Re-read **per
statement** by every helper — there is no cached claim, so revocation is
immediate.

### 3.2 The three helpers (migration 0026)

All `SECURITY DEFINER` (they must read `borrower_invites`, on which borrowers
have no SELECT policy), `SET search_path = public`, `REVOKE ALL FROM public,
anon`, `GRANT EXECUTE TO authenticated`.

```sql
CREATE OR REPLACE FUNCTION public.current_invite_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select coalesce(array_agg(i.id), '{}'::uuid[])
    from public.borrower_invites i
   where auth.uid() is not null
     and i.auth_user_id = auth.uid()
     and i.status = 'active' and i.revoked_at is null and i.expires_at > now()
$$;

CREATE OR REPLACE FUNCTION public.has_borrower_invite() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists (
    select 1 from public.borrower_invites i
     where auth.uid() is not null and i.auth_user_id = auth.uid()
       and i.status = 'active' and i.revoked_at is null and i.expires_at > now())
$$;
```

(`borrower_upload_key_ok` and `borrower_object_budget_ok` are in §5.)

### 3.3 Claim flow — **no `anon` grant anywhere**

This replaces the input designs' `borrower_invite_request_otp(text,text)`
definer granted to `anon`.

1. Broker mints an invite in `apps/web`: `token = randomBytes(32).toString("hex")`;
   only `encode(sha256(convert_to(token,'utf8')),'hex')` is stored in
   `borrower_invites.token_hash` (the exact 0013 pattern). Raw token shown
   once. Link: `https://portal.<domain>/claim?token=<token>`.
2. `/claim` stashes the token in an httpOnly / Secure / SameSite=Lax cookie
   `cx_bi` (10 min TTL) and asks for **the borrower's email**.
3. `POST /api/claim/start` calls `supabase.auth.signInWithOtp({ email,
shouldCreateUser: true })` with the **anon key** — Supabase's own auth
   endpoint, its designed use. **No database function is consulted, so `anon`
   gains no new privilege and there is no enumeration oracle to build.**
4. `/auth/callback` exchanges the OTP → session → reads `cx_bi` → calls
   `claim_borrower_invite(token)`, which verifies the token hash **and**
   `lower(auth.users.email) = lower(invite.email)`, and clears the cookie.

**Why this is strictly stronger:** the second factor is now _control of the
invited mailbox_, not knowledge of a guessable email string. An attacker
holding a leaked link who types their own address gets a valid session for
`attacker@evil.com` — and `claim_borrower_invite` refuses it, because they
are not the invitee. The link alone is worthless; the mailbox is the gate.
Residual (R-9) is email-bombing volume, bounded by rate limits.

### 3.4 Cross-app behaviour

- Borrower session presented to `apps/web` → `protectedProcedure` throws
  `FORBIDDEN "no workspace assigned to this account"` (no profile), and
  `/welcome`'s `org.create` now raises from the DB (§1.3).
- Org session presented to `apps/portal` → `borrowerProcedure` throws
  `FORBIDDEN "no active invitation"` (`current_invite_ids()` is empty).
- Separate origins (`portal.` vs `app.`) → cookie scopes never overlap.

---

## 4. Data model

Three migrations, drizzle-generated DDL first then custom functions/policies
(the established split), with manual `_journal.json` entries at prev
`when` + 1000 (last is `0024` @ `1785330875157`):

| File                            | `when`          | Contents                                                                                    |
| ------------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `0025_<drizzle-generated>`      | `1785330876157` | enums, tables, columns, indexes, `ALTER TYPE notification_kind ADD VALUE 'borrower_upload'` |
| `0026_borrower-portal-rls`      | `1785330877157` | helpers, policies, guards, quotas, grants, audit triggers                                   |
| `0027_borrower-portal-definers` | `1785330878157` | the four client definers + the notification trigger                                         |

`'borrower_upload'` lands in `0025` and is first **referenced** in `0027` —
`ALTER TYPE … ADD VALUE` cannot be used in the transaction that references it
(synthesis §4 standing rule).

### 4.1 Enums

```ts
// packages/schema/src/db/enums.ts
export const borrowerInviteStatus = pgEnum("borrower_invite_status", [
  "pending",
  "active",
  "revoked",
  "expired",
]);
/** Broker-controlled CURATED status shown in the portal. NEVER deals.status. */
export const borrowerPortalStatus = pgEnum("borrower_portal_status", [
  "collecting",
  "in_review",
  "complete",
]);
export const documentRequestStatus = pgEnum("document_request_status", [
  "open",
  "fulfilled",
  "withdrawn",
]);
```

```ts
// packages/schema/src/db/tenancy.ts — one added value
export const notificationKind = pgEnum("notification_kind", [
  "member_joined",
  "document_processed",
  "document_failed",
  "identity_review",
  "review_backlog",
  "borrower_upload", // M12.1
]);
```

### 4.2 `borrower_invites`

New TS file `packages/schema/src/db/borrower.ts`, importing
`deals`/`entities`/`tenants` only; `documents.ts` imports `borrowerInvites`
from it (that direction breaks the cycle).
`document_requests.fulfilled_by_document_id` stays a plain `uuid()` with the
FK added in `0026` — the same deliberate choice as `deals.created_by`.

```sql
CREATE TABLE "borrower_invites" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"        uuid NOT NULL REFERENCES "tenants"("id"),
  "deal_id"          uuid NOT NULL REFERENCES "deals"("id"),
  "entity_id"        uuid REFERENCES "entities"("id"),  -- deterministic prior for M11.6 (Advisory 4)
  "email"            text NOT NULL,
  "token_hash"       text NOT NULL,     -- sha256 of the URL token; raw token never stored (0013)
  "auth_user_id"     uuid,              -- bound by claim_borrower_invite(); no FK to auth.users
  "status"           "borrower_invite_status" DEFAULT 'pending' NOT NULL,
  "portal_status"    "borrower_portal_status" DEFAULT 'collecting' NOT NULL,
  -- SNAPSHOTS: the portal never reads deals/entities, so an internal rename
  -- ("Sunrise — 2nd look, thin DSCR") can never leak to the borrower.
  "display_label"    text NOT NULL,
  "entity_label"     text,
  -- Checklist SNAPSHOT [{key,label,formFamilies[]}] from checklistFor(deal.type),
  -- broker-editable at invite time. Satisfaction is computed ONLY over this
  -- invite's own uploads (closes the deal-composition oracle, Advisory 3).
  "requested_items"  jsonb DEFAULT '[]'::jsonb NOT NULL,
  "max_docs"         integer,           -- per-invite override; NULL = tenant/default
  "max_bytes"        bigint,
  "max_cost_micro_usd" bigint,          -- micro-USD (Iron Law #2: money is integer)
  "invited_by"       uuid NOT NULL,     -- profiles.id (plain uuid, like deals.created_by)
  "expires_at"       timestamptz NOT NULL,
  "claimed_at"       timestamptz,
  "last_reminded_at" timestamptz,
  "revoked_at"       timestamptz,
  "created_at"       timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "borrower_invites_token_hash_uq" ON "borrower_invites" ("token_hash");
CREATE UNIQUE INDEX "borrower_invites_live_uq"
  ON "borrower_invites" ("deal_id", lower("email")) WHERE "status" IN ('pending','active');
CREATE INDEX "borrower_invites_auth_user_idx"
  ON "borrower_invites" ("auth_user_id") WHERE "auth_user_id" IS NOT NULL;
CREATE INDEX "borrower_invites_tenant_idx" ON "borrower_invites" ("tenant_id");
CREATE INDEX "borrower_invites_deal_idx"   ON "borrower_invites" ("deal_id");
```

`borrower_invites_auth_user_idx` is the hot index — every helper hits it.

### 4.3 `document_requests`

```sql
CREATE TABLE "document_requests" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"   uuid NOT NULL REFERENCES "tenants"("id"),
  "deal_id"     uuid NOT NULL REFERENCES "deals"("id"),
  "invite_id"   uuid NOT NULL REFERENCES "borrower_invites"("id"),
  "note"        text NOT NULL,
  "status"      "document_request_status" DEFAULT 'open' NOT NULL,
  "requested_by" uuid NOT NULL,
  "fulfilled_by_document_id" uuid,      -- FK added in 0026
  "created_at"  timestamptz DEFAULT now() NOT NULL,
  "resolved_at" timestamptz
);
CREATE INDEX "document_requests_invite_idx" ON "document_requests" ("invite_id");
```

`invite_id` is **NOT NULL** — a tightening of design 02, which allowed
`NULL = visible to all invites on the deal`. That is a cross-borrower
channel; every request is addressed to exactly one invite.

### 4.4 `documents` — one column, one index swap

```sql
ALTER TABLE "documents" ADD COLUMN "uploaded_via_invite_id" uuid
  REFERENCES "borrower_invites"("id");
CREATE INDEX "documents_invite_idx" ON "documents" ("uploaded_via_invite_id")
  WHERE "uploaded_via_invite_id" IS NOT NULL;

-- sha256-SQUATTING 409 ORACLE (B2 tail): scope uniqueness to the WRITER.
DROP INDEX IF EXISTS "documents_deal_sha256_unique";
CREATE UNIQUE INDEX "documents_deal_sha256_scope_uq" ON "documents" (
  "deal_id", "sha256",
  coalesce("uploaded_via_invite_id", '00000000-0000-0000-0000-000000000000'::uuid)
);
```

Org uploads dedupe against org uploads (the `apps/web` route's 23505 → 409
path is unchanged); each invite dedupes only against itself. A borrower can no
longer learn whether the org holds a given file, cannot squat a digest, and
cannot detect another borrower's uploads. `documents_sha256_idx` (cross-deal
duplicate detection, Stage S) is untouched. Expressed in `documents.ts` as a
`sql`-templated `uniqueIndex` so drizzle's diff emits both statements.

### 4.5 `packages/shared` additions

- **`src/storage/keys.ts`** — `uploadObjectKey` and `pageImageObjectKey`
  **moved here** from `apps/web/src/lib/storage.ts` (imports updated in the
  same PR; the old file keeps `DEAL_DOCUMENTS_BUCKET`, `MAX_UPLOAD_BYTES`,
  `UPLOAD_EXTENSION_BY_MIME`, `createSignedDocumentUrl`), plus:
  ```ts
  export function borrowerUploadObjectKey(
    tenantId: string,
    dealId: string,
    inviteId: string,
    sha256: string,
    mimeType: string,
  ): string;
  // → `${tenantId}/deals/${dealId}/borrower-uploads/${inviteId}/${sha256}.${ext}`
  ```
  One TS builder, one SQL validator (`borrower_upload_key_ok`), and a harness
  scenario (B-33) proving they agree.
- **`src/limits.ts`** — `INVITE_LIMIT_DEFAULTS` + `resolveInviteLimits(settings)`,
  parsed exactly like `resolveDealLimits` (jsonb NUMBER only, positive
  integers, malformed → defaults, never OFF):
  ```ts
  export const INVITE_LIMIT_DEFAULTS = {
    maxDocsPerInvite: 25,
    maxBytesPerInvite: 268_435_456, // 256 MiB
    maxDocsPerInviteHour: 10,
    maxCostMicroUsdPerInvite: 2_500_000n, // $2.50 of the deal's $10 envelope
  };
  ```
  Mirrored by `settings_limit()` in SQL (§7.1) — **change both together**,
  same standing note as 0021.
- **`src/checklist.ts`** — `ChecklistItem` + `checklistFor()` moved out of
  `apps/web/src/lib/doc-checklist.ts` (M8.7 import path updated same PR).
- **`src/security-headers.ts`**, **`src/rate-limit.ts`** — moved from
  `apps/web/src/lib/` so the portal ships identical CSP/headers/throttle.
- **`src/email/templates.ts`** — `borrowerInviteEmail()`, `borrowerReminderEmail()`.

No monetary column changes type: `documents.bytes` stays `integer` (a byte
count is not money); the only money here is micro-USD `bigint`.

---

## 5. Storage: path grammar, policies, budget

### 5.1 Grammar

```
<invite.tenant_id>/deals/<invite.deal_id>/borrower-uploads/<invite.id>/<sha256>.<ext>
       [1]           [2]        [3]              [4]           [5]         [6]
```

Six `/`-separated **elements** (five `storage.foldername` entries — that
discrepancy is exactly what B3 caught). Same bucket, same 50 MiB limit, same
MIME allowlist as 0003; a distinct prefix so no existing policy loosens.

### 5.2 Validator (0026)

```sql
CREATE OR REPLACE FUNCTION public.borrower_upload_key_ok(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare s text[];
begin
  if p_name is null then return false; end if;
  s := string_to_array(p_name, '/');
  if array_length(s,1) is distinct from 6 then return false; end if;      -- B3
  if s[2] <> 'deals' or s[4] <> 'borrower-uploads' then return false; end if;
  if s[6] !~ '^[0-9a-f]{64}\.(pdf|png|jpg|tif|xlsx|xls)$' then return false; end if;
  return exists (
    select 1 from public.borrower_invites i
     where auth.uid() is not null
       and i.auth_user_id = auth.uid()
       and i.status = 'active' and i.revoked_at is null and i.expires_at > now()
       and i.tenant_id::text = s[1]      -- segment 1
       and i.deal_id::text   = s[3]      -- segment 3
       and i.id::text        = s[5]);    -- segment 5
end $$;
```

Comparisons are `uuid::text = segment`, **never** `segment::uuid` — a
malformed segment must return false, not raise (a cast error inside a policy
is both a DoS and an oracle).

### 5.3 Object budget (closes A-5)

```sql
CREATE INDEX IF NOT EXISTS objects_deal_documents_name_pattern
  ON storage.objects (name text_pattern_ops) WHERE bucket_id = 'deal-documents';

CREATE OR REPLACE FUNCTION public.borrower_object_budget_ok(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, storage AS $$
declare s text[]; v_prefix text; v_max bigint; v_n bigint;
begin
  s := string_to_array(p_name, '/');
  if array_length(s,1) is distinct from 6 then return false; end if;
  select coalesce(i.max_docs::bigint,
                  public.settings_limit(t.settings, 'maxDocsPerInvite', 25))
    into v_max
    from public.borrower_invites i join public.tenants t on t.id = i.tenant_id
   where i.id::text = s[5];
  if v_max is null then return false; end if;                 -- unknown invite → deny
  v_prefix := s[1]||'/deals/'||s[3]||'/borrower-uploads/'||s[5]||'/';
  select count(*) into v_n from storage.objects o
   where o.bucket_id = 'deal-documents' and o.name like v_prefix || '%';
  return v_n < v_max;
end $$;
```

Without this, `documents`-row quotas bound _rows_, not _bytes in the bucket_:
a borrower could park unlimited 50 MiB objects that no quota counts and no UI
shows. If a future Supabase platform version refuses DDL on
`storage.objects`, drop the index and keep the function (a seq scan at pilot
volumes is milliseconds) — the correctness does not depend on the index.

### 5.4 The two policies (the only two a borrower ever matches)

```sql
CREATE POLICY "deal_documents_borrower_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deal-documents'
              AND (SELECT public.has_borrower_invite())     -- InitPlan: once per statement
              AND public.borrower_upload_key_ok(name)       -- every segment vs the invite
              AND public.borrower_object_budget_ok(name));  -- bucket flooding

CREATE POLICY "deal_documents_borrower_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'deal-documents'
         AND (SELECT public.has_borrower_invite())
         AND public.borrower_upload_key_ok(name));
-- NO UPDATE, NO DELETE policy: borrower objects are immutable (0003's posture).
```

The `(SELECT …)` wrapper on the no-argument STABLE function is what makes the
whole borrower branch short-circuit as a single InitPlan for org users (R-6).

---

## 6. RLS & guards in `public`

### 6.1 Reference-policy tightening (A-3) — the only edits to existing policies

```sql
DROP POLICY taxonomy_nodes_read ON public.taxonomy_nodes;
CREATE POLICY taxonomy_nodes_read ON public.taxonomy_nodes FOR SELECT TO authenticated
  USING (public.current_tenant_id() IS NOT NULL);

DROP POLICY form_registry_read ON public.form_registry;
CREATE POLICY form_registry_read ON public.form_registry FOR SELECT TO authenticated
  USING (public.current_tenant_id() IS NOT NULL);

DROP POLICY policy_packs_read ON public.policy_packs;
CREATE POLICY policy_packs_read ON public.policy_packs FOR SELECT TO authenticated
  USING (public.current_tenant_id() IS NOT NULL);

DROP POLICY learned_mappings_select ON public.learned_mappings;
CREATE POLICY learned_mappings_select ON public.learned_mappings FOR SELECT TO authenticated
  USING (public.current_tenant_id() IS NOT NULL
         AND (tenant_id IS NULL OR tenant_id = public.current_tenant_id()));
```

No org behaviour changes (an org user always has a tenant); `credexis_worker`
keeps its own `worker_reference_read_*` policies; verified that no pre-profile
`/signup` → `/welcome` path reads any of these four tables (every reader in
`apps/web` sits behind `protectedProcedure`/`underwriterProcedure`).

### 6.2 `borrower_invites` — org side only, no borrower policy

```sql
ALTER TABLE "borrower_invites" ENABLE ROW LEVEL SECURITY;

CREATE POLICY borrower_invites_select ON "borrower_invites" FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY borrower_invites_insert ON "borrower_invites" FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.role_tier(public.current_user_role()) >= 2      -- underwriter+
              AND invited_by = auth.uid()
              AND deal_id IN (SELECT id FROM public.deals)               -- A-4: RLS-filtered
              AND (entity_id IS NULL OR EXISTS (
                    SELECT 1 FROM public.entities e
                     WHERE e.id = entity_id AND e.deal_id = borrower_invites.deal_id))
              AND auth_user_id IS NULL AND claimed_at IS NULL AND status = 'pending'
              AND expires_at > now() AND expires_at < now() + interval '60 days');

CREATE POLICY borrower_invites_update ON "borrower_invites" FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.role_tier(public.current_user_role()) >= 2)
  WITH CHECK (tenant_id = public.current_tenant_id());
-- no DELETE policy: append-mostly (revoke stamps revoked_at).
```

**RLS cannot restrict columns** (A-1), so:

```sql
REVOKE UPDATE ON public.borrower_invites FROM authenticated;
GRANT UPDATE (status, portal_status, display_label, entity_label, requested_items,
              expires_at, revoked_at, last_reminded_at, max_docs, max_bytes,
              max_cost_micro_usd)
  ON public.borrower_invites TO authenticated;
-- tenant_id, deal_id, entity_id, email, token_hash, auth_user_id, claimed_at
-- are definer-only.
```

Plus a transition guard. (A GUC flag would be useless: `authenticated` can
`set_config` any custom GUC. The guard instead keys on a transition only the
definer can make, because only the owner may write `auth_user_id`.)

```sql
CREATE OR REPLACE FUNCTION public.borrower_invites_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
begin
  if old.status in ('revoked','expired') and new.status <> old.status then
    raise exception 'borrower invite: status is terminal';
  end if;
  if new.status = 'active' and old.status <> 'active'
     and (old.auth_user_id is not null or new.auth_user_id is null) then
    raise exception 'borrower invite: only claim_borrower_invite() activates an invite';
  end if;
  return new;
end $$;
CREATE TRIGGER borrower_invites_guard BEFORE UPDATE ON "borrower_invites"
  FOR EACH ROW EXECUTE FUNCTION public.borrower_invites_guard();
```

### 6.3 `document_requests` — org side only

```sql
ALTER TABLE "document_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_requests_select ON "document_requests" FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY document_requests_insert ON "document_requests" FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.role_tier(public.current_user_role()) >= 2
              AND requested_by = auth.uid()
              AND invite_id IN (SELECT id FROM public.borrower_invites));
CREATE POLICY document_requests_update ON "document_requests" FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.role_tier(public.current_user_role()) >= 2)
  WITH CHECK (tenant_id = public.current_tenant_id());
```

### 6.4 `documents` — the path guard (B2), a trigger not a policy

No borrower INSERT policy and no borrower SELECT policy exist (see A-2/A-6).
B2's _intent_ — the path is pinned at the DB layer and nobody writes around
it — is enforced by a trigger, which binds the client, the definer, the
service-role worker and `postgres` alike:

```sql
CREATE OR REPLACE FUNCTION public.documents_invite_path_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare inv record; v_ext text;
begin
  -- Immutability of the lineage-bearing columns (any writer, any path).
  if tg_op = 'UPDATE' then
    if new.storage_path is distinct from old.storage_path
       or new.sha256    is distinct from old.sha256
       or new.tenant_id is distinct from old.tenant_id
       or new.deal_id   is distinct from old.deal_id
       or new.uploaded_via_invite_id is distinct from old.uploaded_via_invite_id then
      raise exception 'documents: storage_path/sha256/tenant/deal/invite are immutable';
    end if;
    return new;
  end if;

  if new.uploaded_via_invite_id is null then
    if new.storage_path like '%/borrower-uploads/%' then
      raise exception 'documents: borrower prefix requires uploaded_via_invite_id';
    end if;
    return new;
  end if;

  select * into inv from public.borrower_invites where id = new.uploaded_via_invite_id;
  if inv.id is null then raise exception 'documents: unknown borrower invite'; end if;
  if new.tenant_id <> inv.tenant_id or new.deal_id <> inv.deal_id then
    raise exception 'documents: borrower row tenant/deal do not match the invite';
  end if;
  if new.uploaded_by is distinct from inv.auth_user_id then
    raise exception 'documents: uploader is not the invite holder';
  end if;
  v_ext := substring(new.storage_path from '\.([a-z]{3,4})$');
  if new.storage_path <> inv.tenant_id::text || '/deals/' || inv.deal_id::text
       || '/borrower-uploads/' || inv.id::text || '/' || new.sha256 || '.' || coalesce(v_ext,'')
  then raise exception 'documents: storage_path is not pinned to the invite'; end if;
  return new;
end $$;
CREATE TRIGGER documents_invite_path_guard BEFORE INSERT OR UPDATE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION public.documents_invite_path_guard();
```

BEFORE triggers fire in **name order**, so `documents_invite_path_guard` runs
before `documents_upload_limits` (0021) — the path is validated before quotas
are counted.

### 6.5 Borrower notification fan-out (B1) — a trigger, never an RPC

```sql
CREATE OR REPLACE FUNCTION public.notify_borrower_upload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare inv record;
begin
  if new.uploaded_via_invite_id is null then return new; end if;
  select * into inv from public.borrower_invites where id = new.uploaded_via_invite_id;
  perform public.notify_tier(
    new.tenant_id, 2, 'borrower_upload',
    'New borrower upload',                                   -- fixed title, not caller-controlled
    left(regexp_replace(coalesce(inv.entity_label, inv.email), '[[:cntrl:]]', '', 'g'), 60)
      || ' uploaded a document',                             -- broker-authored strings only
    '/deals/' || new.deal_id::text || '/documents',          -- app-relative (notify_tier re-validates)
    new.deal_id,
    'borrower_upload:' || inv.id::text || ':' || to_char(now(),'YYYYMMDDHH24'));  -- ≤1/invite/hour
  return new;
end $$;
CREATE TRIGGER documents_notify_borrower_upload AFTER INSERT ON "documents"
  FOR EACH ROW EXECUTE FUNCTION public.notify_borrower_upload();
REVOKE ALL ON FUNCTION public.notify_borrower_upload() FROM public, anon, authenticated;
```

### 6.6 Audit

```sql
CREATE TRIGGER borrower_invites_audit  AFTER INSERT OR UPDATE OR DELETE ON "borrower_invites"
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();
CREATE TRIGGER document_requests_audit AFTER INSERT OR UPDATE OR DELETE ON "document_requests"
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();
CREATE TRIGGER documents_borrower_audit AFTER INSERT ON "documents"
  FOR EACH ROW WHEN (new.uploaded_via_invite_id IS NOT NULL)
  EXECUTE FUNCTION public.audit_record();
```

`audit_record()` (0004) reads `new.tenant_id` / `new.id` generically and all
three tables carry both; `audit_log.actor_id` is a plain uuid (no FK), so a
borrower uid records fine. Invite claim, revocation and every borrower upload
therefore enter the 0024 hash chain with the borrower as actor.

---

## 7. Quotas & cost ceilings

### 7.1 One settings parser, four keys

```sql
CREATE OR REPLACE FUNCTION public.settings_limit(p_settings jsonb, p_key text, p_default bigint)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE AS $$
declare v jsonb;
begin
  v := p_settings #> array['limits', p_key];
  if jsonb_typeof(v) = 'number' and (v)::text ~ '^[1-9][0-9]*$' then
    return (v)::text::bigint;
  end if;
  return p_default;   -- malformed/absent → default, NEVER off
end $$;
```

`enforce_deal_upload_limits()` is `CREATE OR REPLACE`d (the 0022 pattern) to
use this parser for the deal keys **and** to add the per-invite branch. Lock
order is fixed — deal lock first, then invite lock — so it is deadlock-free:

```sql
  -- ... existing per-deal advisory lock + deal ceilings, now via settings_limit ...
  if new.uploaded_via_invite_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.uploaded_via_invite_id::text, 1));

    select i.max_docs, i.max_bytes, t.settings
      into v_i_docs_ovr, v_i_bytes_ovr, v_settings
      from borrower_invites i join tenants t on t.id = i.tenant_id
     where i.id = new.uploaded_via_invite_id;

    v_i_docs  := coalesce(v_i_docs_ovr::bigint,  settings_limit(v_settings,'maxDocsPerInvite',25));
    v_i_bytes := coalesce(v_i_bytes_ovr,         settings_limit(v_settings,'maxBytesPerInvite',268435456));
    v_i_hour  :=                                 settings_limit(v_settings,'maxDocsPerInviteHour',10);

    select count(*), coalesce(sum(bytes),0),
           count(*) filter (where created_at > now() - interval '1 hour')
      into v_ic, v_ib, v_ih
      from documents where uploaded_via_invite_id = new.uploaded_via_invite_id;

    if v_ic >= v_i_docs then raise exception 'borrower upload limit reached (% files)', v_i_docs; end if;
    if v_ib + new.bytes > v_i_bytes then raise exception 'borrower storage limit reached (% bytes)', v_i_bytes; end if;
    if v_ih >= v_i_hour then raise exception 'borrower upload rate limit reached (% per hour)', v_i_hour; end if;
  end if;
```

### 7.2 Per-invite extraction spend (closes R-5)

```sql
CREATE OR REPLACE FUNCTION public.invite_extraction_spend(p_invite uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select coalesce(sum(r.cost_micro_usd), 0)::bigint
    from extraction_runs r
    join documents d on d.id = r.document_id
   where d.uploaded_via_invite_id = p_invite
$$;
REVOKE ALL ON FUNCTION public.invite_extraction_spend(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_extraction_spend(uuid) TO service_role;
```

Same posture as `deal_extraction_spend` (0022c): a definer bypasses RLS, so
granting it to `authenticated` would let any signed-in user learn any tenant's
spend by guessing a uuid. The worker checks it at the same point it checks the
deal ceiling; a borrower who exhausts `max_cost_micro_usd` stops consuming
extraction while the broker's own uploads keep working.

---

## 8. Worker-side (defense in depth)

### 8.1 Prefix assertion in `runIngest`

`packages/pipeline/src/ports.ts` — `DocumentRow` gains
`uploadedViaInviteId: string | null` and `virusScan: VirusScanStatus`;
`supabase.ts::getDocument` adds both to its `select`. In `runIngest`,
immediately after the existing tenant/deal check (`ingest.ts:66`) and
**before** `storage.download`:

```ts
const prefix = `${doc.tenantId}/deals/${doc.dealId}/`;
if (!doc.storagePath.startsWith(prefix)) {
  throw new Error("ingest: storage_path is outside the document's tenant/deal prefix");
}
if (doc.uploadedViaInviteId) {
  const pinned = `${prefix}borrower-uploads/${doc.uploadedViaInviteId}/${doc.sha256}.`;
  if (!doc.storagePath.startsWith(pinned)) {
    throw new Error("ingest: borrower storage_path is not pinned to its invite");
  }
}
```

Same posture as the sibling tenant/deal check: throws **pre-`processing`**, so
the task retries and dead-letters rather than flipping another tenant's
document to `failed`. The DB trigger makes this state unreachable; this is the
belt for that brace, and it unit-tests against fakes with no database.

### 8.2 AV gate for borrower-originated documents (GAP-9)

```ts
if (doc.uploadedViaInviteId && (!deps.scanner || virusScan !== "clean")) {
  throw new Error("borrower upload: a clean AV verdict is required before extraction");
}
```

The existing row-level lock in `ingest-document.ts:214` (`virus_scan !==
"clean"` → withheld run + no vendor call) remains the second lock. Org uploads
keep today's honest `pending` behaviour when no scanner is wired; borrower
uploads do not get that latitude.

### 8.3 Duplicate-gate (mitigation for R-4)

Before the extraction block in `ingest-document.ts`, alongside the AV check:

```ts
const { data: twin } = await client
  .from("documents")
  .select("id")
  .eq("deal_id", payload.dealId)
  .eq("sha256", doc.sha256)
  .neq("id", payload.documentId)
  .eq("status", "processed")
  .order("created_at")
  .limit(1)
  .maybeSingle();
if (twin) extractionBlocked = `byte-identical to document ${twin.id} — extraction withheld`;
```

Records the same cost-0 withheld `extraction_runs` row the AV gate does. The
**borrower is never told**: the portal reports "Received" identically for a
new file and a duplicate, so this creates no oracle.

---

## 9. The four client-reachable definers (0027)

| Function                                                                                       | Grantee         | Reads                                                               | Returns                         |
| ---------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------- | ------------------------------- |
| `claim_borrower_invite(p_token text)` → `uuid`                                                 | `authenticated` | `borrower_invites`, `profiles`, `auth.users`                        | invite id; binds `auth_user_id` |
| `borrower_portal_state()` → `jsonb`                                                            | `authenticated` | own invites, own-invite `documents`, own-invite `document_requests` | curated jsonb (§10)             |
| `borrower_attach_upload(p_invite uuid, p_sha256 text, p_ext text, p_file_name text)` → `jsonb` | `authenticated` | `borrower_invites`, `storage.objects`                               | `{documentId, received:true}`   |
| `current_invite_ids()` → `uuid[]`                                                              | `authenticated` | `borrower_invites`                                                  | the caller's active invite ids  |

Every one derives the invite from `auth.uid()`; the only caller-supplied
identifier is `p_invite`, verified against `auth_user_id = auth.uid()`.
All: `SECURITY DEFINER`, `SET search_path`, `REVOKE ALL FROM public, anon`,
`GRANT EXECUTE TO authenticated`.

```sql
CREATE OR REPLACE FUNCTION public.claim_borrower_invite(p_token text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
declare v_uid uuid := auth.uid(); v_email text; v_inv record;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'this account belongs to an organization workspace';   -- disjointness
  end if;
  select email into v_email from auth.users where id = v_uid;
  select * into v_inv from public.borrower_invites
   where token_hash = encode(sha256(convert_to(p_token,'utf8')),'hex')
     and status in ('pending','active') and revoked_at is null and expires_at > now();
  if v_inv.id is null then raise exception 'invitation not found, expired, or revoked'; end if;
  if lower(v_inv.email) <> lower(coalesce(v_email,'')) then
    raise exception 'this invitation was issued to a different email address';
  end if;
  if v_inv.auth_user_id is not null and v_inv.auth_user_id <> v_uid then
    raise exception 'this invitation has already been claimed';            -- single seat
  end if;
  update public.borrower_invites
     set auth_user_id = v_uid, status = 'active', claimed_at = coalesce(claimed_at, now())
   where id = v_inv.id;
  return v_inv.id;                                                          -- idempotent
end $$;
```

```sql
CREATE OR REPLACE FUNCTION public.borrower_attach_upload(
  p_invite uuid, p_sha256 text, p_ext text, p_file_name text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, storage AS $$
declare inv record; v_key text; v_size bigint; v_mime text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bad digest'; end if;
  v_mime := case p_ext
    when 'pdf' then 'application/pdf'  when 'png' then 'image/png'
    when 'jpg' then 'image/jpeg'       when 'tif' then 'image/tiff'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'xls'  then 'application/vnd.ms-excel' end;
  if v_mime is null then raise exception 'unsupported extension'; end if;

  select * into inv from public.borrower_invites
   where id = p_invite and auth_user_id = auth.uid()
     and status='active' and revoked_at is null and expires_at > now();
  if inv.id is null then raise exception 'invitation is not active'; end if;

  v_key := inv.tenant_id::text || '/deals/' || inv.deal_id::text
           || '/borrower-uploads/' || inv.id::text || '/' || p_sha256 || '.' || p_ext;

  -- AUTHORITATIVE size: the caller cannot understate bytes to evade quotas.
  select (o.metadata->>'size')::bigint into v_size
    from storage.objects o where o.bucket_id = 'deal-documents' and o.name = v_key;
  if v_size is null then raise exception 'upload not finalized for this digest'; end if;  -- fails CLOSED

  insert into public.documents (tenant_id, deal_id, file_name, storage_path, sha256,
                                bytes, mime_type, uploaded_by, uploaded_via_invite_id)
  values (inv.tenant_id, inv.deal_id,
          left(regexp_replace(coalesce(p_file_name,'upload'), '[[:cntrl:]/\\]', '', 'g'), 120),
          v_key, p_sha256, v_size::int, v_mime, auth.uid(), inv.id)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then         -- same digest, same invite: idempotent, NO oracle
    select id into v_id from public.documents
     where deal_id = inv.deal_id and sha256 = p_sha256 and uploaded_via_invite_id = inv.id;
  end if;
  return jsonb_build_object('documentId', v_id, 'received', true);
end $$;
```

Because there is no borrower INSERT policy on `documents`, this is the **only**
way a borrower-originated row is born.

---

## 10. Portal & broker UX

### 10.1 `apps/portal` — separate Next.js app, separate origin

Confirms design 02 §1.1, and it is also the smallest blast radius: the portal
deployment physically contains no underwriting router, no spread components,
no AG Grid, no `packages/engine` import — there is no shared tRPC root to
mis-scope and no middleware matcher to forget. Deployed at `portal.<domain>`
so org and borrower cookies never share a scope. Same Supabase project, one
`auth.users` namespace.

`apps/portal/src/middleware.ts` mirrors `apps/web`'s (fail-closed `getUser()`,
public paths `/claim`, `/auth`, `/signed-out`, CSP + security headers from
`@credexis/shared`, `/api/*` write throttle) plus a stricter claim-start limit
(5/hour/IP) and an **absolute session age check**: decode the session JWT's
`iat`; beyond 12 hours, sign out and redirect to `/signed-out`.

```ts
/** Signed in AND holding ≥1 active borrower invite. No role ladder exists here. */
export const borrowerProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  const { data } = await ctx.supabase.rpc("current_invite_ids");
  const ids = (data ?? []) as string[];
  if (ids.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "no active invitation" });
  return next({ ctx: { ...ctx, user: ctx.user, inviteIds: ids } });
});
```

### 10.2 Four screens, total

1. **`/claim?token=…`** — "**<display_label>** — <Broker Org> has asked you to
   send documents." One field: _Your email address_. Always answers "If that
   link is valid, we've emailed you a sign-in link."
2. **`/auth/callback`** — exchange OTP → read `cx_bi` → `claim_borrower_invite`
   → clear cookie → `/`. Failures render plainly ("This invitation has
   expired — ask your loan officer for a new link").
3. **`/` — Documents.** Everything from one `borrower_portal_state()` call:
   ```json
   {
     "inviteId": "…",
     "label": "Sunrise Motel Acquisition",
     "entityLabel": "Sunrise Motel LLC",
     "expiresAt": "2026-09-01T00:00:00Z",
     "status": "collecting|action_needed|received|in_review|complete",
     "items": [
       { "key": "business_returns", "label": "Business tax returns (3y)", "satisfied": true }
     ],
     "uploads": [
       { "fileName": "2023.pdf", "uploadedAt": "…", "state": "received|needs_replacement" }
     ],
     "requests": [
       { "id": "…", "note": "Could you also send the 2024 rent roll?", "createdAt": "…" }
     ]
   }
   ```
4. **`/signed-out`** — "Open your emailed link again to continue." No re-auth form.

### 10.3 Curation guarantees (precise)

- **Status is server-derived and coarse**, from borrower-visible facts only:
  `complete` (broker set `portal_status`) → `action_needed` (an open
  `document_requests` row) → `collecting` (an unsatisfied `requested_items`
  entry) → `received` (own uploads still processing) → `in_review`. It
  **never reads `deals.status`**, so `intake|parsing|review|complete` never
  leaves the database on a borrower call. The client renders the string and
  computes nothing (C1 posture).
- **Item satisfaction** is computed **only** over
  `documents.uploaded_via_invite_id = <this invite>` joined to
  `logical_documents.form_family`. Nothing the org or a co-guarantor uploads
  moves the borrower's checkboxes (Advisory 3, closed at the root).
- **`label`/`entityLabel` are snapshots** taken at invite time; a later
  internal rename is permanently invisible to the borrower.
- **Per-file state is two-valued**: `virus_scan ∈ (infected,failed)` or
  `status='failed'` → **"Couldn't read this — please upload it again"**;
  everything else → **"Received"**. The borrower never learns whether
  extraction ran, succeeded, or exists.
- **Never present at any layer**: metrics, DSCR, facts, issues, gates,
  add-backs, scenarios, other entities' or borrowers' documents, org member
  names, other deals, `audit_log`, `notifications`, the `deals` row, `entities`.

### 10.4 Upload path

`POST /api/upload` (multipart, borrower's JWT) → MIME + 50 MiB check →
sha256 server-side → `borrowerUploadObjectKey(...)` from `@credexis/shared` →
`supabase.storage.upload(key, bytes, { upsert:false })` **under the
borrower's RLS-scoped client** (the storage policy is the real boundary — the
browser could call the Storage API directly and hit the same wall) →
`rpc("borrower_attach_upload", …)` → `triggerIngest(...)` with a Trigger.dev
token scoped to `ingest-document` only. Quota rejections surface as friendly
429s from `resolveInviteLimits`; the DB trigger is the backstop no caller can
skip. Duplicates always return `201 {received:true}`.

### 10.5 Broker side (`apps/web`)

- **`/deals/[dealId]/borrower`** — new tab in the deal shell (`PageHeader` +
  `Tabs` from M11.1). Invitations table (email · entity · status chip · uploads
  · last activity · expiry) with _Copy link_ (raw token shown once, exactly
  like `/org/invites`), _Resend_, _Extend 30 days_, _Revoke_ (immediate).
- **Invite borrower** dialog: email, entity picker, checklist editor
  pre-filled from `checklistFor(deal.type)` and snapshotted into
  `requested_items`, optional `display_label` override defaulting to `deals.name`.
- **Request more documents**: note box writing a `document_requests` row
  against **one** invite, with a visible "the borrower will read this" hint.
- **Mark collection complete**: sets `portal_status='complete'`.
- Documents table gains a _via borrower portal_ badge; the M11.6 identity
  substage consumes `uploaded_via_invite_id → entity_id` as a deterministic
  prior (Advisory 4).
- Bell gets `borrower_upload` cards, tier ≥ 2, ≤1 per invite per hour.
- **Chasing**: `packages/pipeline/src/trigger/chase-borrowers.ts`
  (`schedules.task`, worker context, service-role legal per `supabase.ts`):
  one reminder at T+7 for invites with unsatisfied items on non-complete
  deals, `last_reminded_at` stamped, plus a sweep flipping past-`expires_at`
  invites to `expired`. Cadence from `tenants.settings`, never literals
  (Advisory 5); selection logic in a unit-tested module, the trigger file a
  thin binding.

### 10.6 X4 e2e contract

New pages only; **no existing accessible name changes**. New portal spec
asserts: `heading` name = the invite's `display_label`, `button` name exactly
`"Upload"`, and the visible `"✓ <filename>"` convention preserved on the
uploads list.

---

## 11. RLS harness scenarios — the ship gate

`packages/schema/src/rls/rls-harness.test.ts`, `describe("borrower portal (M12.1)")`.
Fixtures: `U.borrower1` (an `auth.users` row with **no** `profiles` row) bound
to `INVITE_A1` on `DEAL_A`; `U.borrower2` bound to `INVITE_A2` on the same
deal; unclaimed `INVITE_B1` on `DEAL_B`. Seed `storage.objects.metadata` with
`{"size": N}` so §9's authoritative-size path is exercised.

`harness.ts::prepareDatabase` reconcile block gains (it re-grants blanket
access after migrations, so the new revokes must be re-applied there or they
are silently undone):

```sql
revoke all on function public.notify_borrower_upload() from public, anon, authenticated;
revoke all on function public.invite_extraction_spend(uuid) from public, anon, authenticated;
grant  execute on function public.invite_extraction_spend(uuid) to service_role;
revoke update on public.borrower_invites from authenticated;
grant  update (status, portal_status, display_label, entity_label, requested_items,
               expires_at, revoked_at, last_reminded_at, max_docs, max_bytes,
               max_cost_micro_usd)
  on public.borrower_invites to authenticated;
```

| #    | Scenario                                                                                                                                                                                                                                                                                                             | Pins                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| B-01 | table-driven: `borrower1` SELECT on each of `deals, entities, periods, documents, logical_documents, pages, facts, issues, computed_metrics, addbacks, loan_scenarios, extraction_runs, document_identities, notifications, profiles, tenants, invites, borrower_invites, document_requests, audit_log` → **0 rows** | §1.2                            |
| B-02 | `borrower1` SELECT `taxonomy_nodes`/`form_registry`/`policy_packs`/`learned_mappings` → 0 rows; `underwriterA` still sees them                                                                                                                                                                                       | §6.1 (A-3)                      |
| B-03 | `borrower1` INSERT into `documents` → denied (no policy)                                                                                                                                                                                                                                                             | A-6                             |
| B-04 | `borrower1` INSERT `storage.objects` at their exact key → **allowed**                                                                                                                                                                                                                                                | §5.4                            |
| B-05 | …at `borrower2`'s invite segment → denied                                                                                                                                                                                                                                                                            | B3                              |
| B-06 | …right invite, wrong deal segment → denied                                                                                                                                                                                                                                                                           | B3                              |
| B-07 | …right invite, wrong tenant segment → denied                                                                                                                                                                                                                                                                         | B3                              |
| B-08 | …5-element key `t/deals/d/borrower-uploads/<sha>.pdf` → denied                                                                                                                                                                                                                                                       | **B3 off-by-one regression**    |
| B-09 | …7 elements, or a `..` traversal leaf → denied                                                                                                                                                                                                                                                                       | A-8                             |
| B-10 | …non-sha256 leaf, or a disallowed extension → denied                                                                                                                                                                                                                                                                 | §5.2                            |
| B-11 | …malformed uuid in segment 5 (`not-a-uuid`) → returns denied, **does not raise**                                                                                                                                                                                                                                     | A-7                             |
| B-12 | `borrower1` SELECT `storage.objects` → only their own prefix (not `borrower2`'s, not `uploads/`)                                                                                                                                                                                                                     | §5.4                            |
| B-13 | `underwriterA` SELECT `storage.objects` → still the whole tenant prefix **including** `borrower-uploads/`                                                                                                                                                                                                            | no org regression               |
| B-14 | `borrower1` UPDATE/DELETE `storage.objects` → 0 rows / denied                                                                                                                                                                                                                                                        | immutability                    |
| B-15 | object budget: with `max_docs = 2`, the 3rd raw storage INSERT is denied even with **no** `documents` rows                                                                                                                                                                                                           | **A-5**                         |
| B-16 | revoke `INVITE_A1` → storage INSERT **and** SELECT deny immediately; `current_invite_ids()` = `{}`; `borrower_portal_state()` = `[]`                                                                                                                                                                                 | revocation                      |
| B-17 | same for `expires_at` in the past                                                                                                                                                                                                                                                                                    | expiry                          |
| B-18 | `claim_borrower_invite` with an email ≠ the auth email → raises                                                                                                                                                                                                                                                      | §3.3                            |
| B-19 | `claim_borrower_invite` by `underwriterA` → raises "belongs to an organization workspace"                                                                                                                                                                                                                            | disjointness                    |
| B-20 | `create_organization()` by `borrower1` → raises                                                                                                                                                                                                                                                                      | disjointness                    |
| B-21 | `accept_invite()` by `borrower1` → raises                                                                                                                                                                                                                                                                            | disjointness                    |
| B-22 | `claim_borrower_invite` twice by the same uid → idempotent; by a **different** uid → raises "already claimed"                                                                                                                                                                                                        | single seat                     |
| B-23 | `borrower_attach_upload` for an invite the caller does not hold → raises                                                                                                                                                                                                                                             | §9                              |
| B-24 | `borrower_attach_upload` with no matching `storage.objects` row → raises (**fails closed**)                                                                                                                                                                                                                          | R-3                             |
| B-25 | `borrower_attach_upload` writes `documents.bytes` from `metadata->>'size'`, ignoring anything the caller could claim                                                                                                                                                                                                 | A-6                             |
| B-26 | **confused deputy**: superuser INSERT into `documents` with `uploaded_via_invite_id = INVITE_A1` and `storage_path` under `TENANT_B` → raises                                                                                                                                                                        | **B2**                          |
| B-27 | org INSERT with `uploaded_via_invite_id IS NULL` and a `/borrower-uploads/` path → raises                                                                                                                                                                                                                            | B2                              |
| B-28 | UPDATE of `storage_path`/`sha256`/`deal_id` on any `documents` row (even as superuser) → raises                                                                                                                                                                                                                      | §6.4                            |
| B-29 | per-invite quota: `max_docs = 2`, 10 concurrent `borrower_attach_upload` calls → exactly 2 land                                                                                                                                                                                                                      | §7.1 (mirrors 0022's lock test) |
| B-30 | 409 oracle: identical bytes uploaded by `borrower1` **and** by the org on `DEAL_A` both succeed; the same bytes twice within `INVITE_A1` yields one row and no distinguishable response                                                                                                                              | B2-tail                         |
| B-31 | `borrower_portal_state()` for `borrower1` contains no filename from `borrower2`, and `items[].satisfied` does **not** flip when the ORG uploads a matching form family to the same deal                                                                                                                              | **Advisory 3**                  |
| B-32 | `notify_tier`, `notify_borrower_upload`, `invite_extraction_spend` are **not** executable by `authenticated` (`has_function_privilege`)                                                                                                                                                                              | B1                              |
| B-33 | the SQL validator and the TS builder agree: for a fixture triple, `borrowerUploadObjectKey()`'s output satisfies `borrower_upload_key_ok()`, and every mutation of it does not                                                                                                                                       | §4.5                            |
| B-34 | column grants: `underwriterA` UPDATE setting `auth_user_id` → denied; setting `revoked_at` → allowed; setting `status='active'` by hand → raises from the guard                                                                                                                                                      | **A-1**                         |
| B-35 | `borrower_invites_insert` with a `deal_id` from `TENANT_B` → denied; with an `entity_id` from another deal → denied                                                                                                                                                                                                  | **A-4**                         |
| B-36 | one borrower upload writes exactly one `borrower_upload` notification to tier ≥ 2; a second upload in the same hour writes none                                                                                                                                                                                      | B1 dedupe                       |
| B-37 | `audit_log` contains the invite claim with `actor_id = borrower1`, and `verify_audit_chain(TENANT_A)` stays unbroken across borrower writes                                                                                                                                                                          | §6.6                            |

**No policy in this document merges without its scenario in the same PR.**

---

## 12. Build order

Seven PRs, one task ID per branch, conventional commits, acceptance criteria
quoted in the description. Nothing is user-reachable until PR 6.
Dependency chain: **1 → 2 → 3 → {4, 5} → 6 → 7** (4 and 5 parallelize).

| PR    | Branch                     | Acceptance criterion (one line)                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | `m12-1a-borrower-schema`   | Migration `0025` + `borrower.ts`/`enums.ts`/`tenancy.ts`/`documents.ts` land with zero behaviour change: `pnpm typecheck`, `schema-checks`, and the **existing** RLS harness (with the dedupe scenario updated for the scoped sha256 index) are green                                                                                                                                                                         |
| **2** | `m12-1b-borrower-rls`      | Migration `0026` lands the entire security floor with **no way to reach it**: helpers, the two storage policies, both guards, per-invite quotas, org-side RLS + column grants, the four reference-policy tightenings, audit triggers — and harness scenarios **B-01…B-17, B-26…B-29, B-34, B-35** are green in CI, with an `EXPLAIN (ANALYZE)` note proving one InitPlan evaluation for an org-user storage listing           |
| **3** | `m12-1c-borrower-definers` | Migration `0027` + the `packages/shared` moves (`storage/keys.ts`, `checklist.ts`, `limits.ts`, `security-headers.ts`, `rate-limit.ts`, email templates) land with harness scenarios **B-18…B-25, B-30…B-33, B-36, B-37** green and `pnpm test` green                                                                                                                                                                         |
| **4** | `m12-1d-broker-invite-ui`  | A broker can mint, copy-link, resend, extend and revoke a borrower invite from `/deals/[dealId]/borrower`, and write a document request — with router unit tests and `mutation-tier.test.ts` extended; no e2e accessible name changes                                                                                                                                                                                         |
| **5** | `m12-1e-portal-app`        | A real borrower completes `/claim` → OTP → `claim_borrower_invite` → `/` and sees a curated, **empty** state at `portal.<domain>` (no upload path yet), with CSP/headers/rate limits live and a manual pen-pass against §1.4's enumeration recorded in the PR                                                                                                                                                                 |
| **6** | `m12-1f-portal-upload`     | The first PR that lets bytes in: portal `/api/upload` + `borrower_attach_upload` + `triggerIngest` (scoped token), pipeline `uploadedViaInviteId`/`virusScan` + prefix assertion + AV gate + duplicate-gate + per-invite spend ceiling — **gated on** `pnpm eval` not regressing, the RLS harness green in CI, a **live smoke test proving `storage.objects.metadata->>'size'` is populated**, and **key rotation completed** |
| **7** | `m12-1g-borrower-comms`    | `borrower_upload` cards reach the bell, `chase-borrowers` sends exactly one T+7 reminder and sweeps expiries with cadence from `tenants.settings`, and document requests round-trip on both sides — cadence module unit-tested, email advisory-only                                                                                                                                                                           |

PRs 2 and 3 are pure DB + tests: they need neither Anthropic credits nor
`pnpm eval`, so they can land while CI billing is being restored. **PR 6
cannot.**

Docs updated in the same PRs (Iron Law #10): `docs/MASTER_TASK_LIST.md` M12.1,
`docs/ARCHITECTURE.md` §2 (storage grammar + the borrower identity class),
`docs/environments.md` (portal project + scoped Trigger token), and this file.

---

## 13. Needs Pratik's decision (product/ops, not engineering)

| #        | Decision                                                                                                                                                                                                                                                           | Why it's yours                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| **D-1**  | **Domain for the portal** — `portal.credexis.co` vs `apply.credexis.co`. Affects the Resend sending domain, SPF/DKIM/DMARC records, and the Supabase `uri_allow_list`                                                                                              | Brand + deliverability, and borrowers must recognise the link as legitimate |
| **D-2**  | **One Supabase project or two.** A second project for the portal would let borrower JWT/refresh lifetimes be short without shortening bankers' (R-2), at the cost of a second project, second bill, and cross-project invite sync                                  | Cost/ops vs a real hardening win a bank reviewer will ask about             |
| **D-3**  | **Turnstile/hCaptcha on the claim form** (R-9). Closes drive-by magic-link spam; adds a vendor to the subprocessor list and a small borrower friction                                                                                                              | Vendor + UX call                                                            |
| **D-4**  | **Disjointness product limit** (R-8): a solo broker who is also a guarantor on their own deal cannot use the portal with the same email. Accept, or spend a milestone on multi-class identity?                                                                     | Pilot-customer reality                                                      |
| **D-5**  | **Key rotation date** — Supabase/Trigger/Azure keys pending. Pratik has already ruled rotation happens **before real borrower data** (deferred to MVP 2 close), which is exactly this gate: it stays a **hard gate on PR 6**. What is still open is the date.      | Ops scheduling                                                              |
| ~~D-6~~  | ~~CI billing + Anthropic credits~~ — **RESOLVED 2026-07-29**: Pratik added GitHub Actions billing (and the CI matrix was consolidated 10→5 jobs, ~40% fewer minutes); Anthropic credits topped up 2026-07-28. PR 6's gates can run.                                | —                                                                           |
| **D-7**  | **Default per-invite ceilings**: 25 docs / 256 MiB / 10 per hour / **$2.50** of the deal's $10 extraction envelope. These are solvency controls as much as security controls                                                                                       | Unit economics                                                              |
| **D-8**  | **Invite lifetime** (default 30 days, max 60) and **reminder cadence** (one at T+7 pre-pilot)                                                                                                                                                                      | Collections behaviour brokers will have opinions about                      |
| **D-9**  | **Retention**: how long borrower-uploaded documents and `borrower_invites` rows live after a deal closes, and whether a borrower may request deletion (GAP-5). Also whether `outbound_emails` (borrower addresses + subject lines) is in scope for the same policy | Legal/contractual                                                           |
| **D-10** | **Email authenticity** (GAP-7): SPF/DKIM/DMARC alignment + the subprocessor list (Supabase, Vercel, Trigger.dev, Reducto, Anthropic, Resend) published before pilot                                                                                                | Compliance paperwork                                                        |

---

## 14. What this plan explicitly does **not** close

Named so nobody claims otherwise in a vendor questionnaire:

- **Idle/absolute session timeout** below the app layer (R-2) — mitigated by
  invite expiry + per-statement re-checks, not solved.
- **Authentication event logging** (GAP-4): sign-ins, failed OTPs, session
  revocations are still not queryable per tenant. `audit_log` covers table
  mutations only. The invite _claim_ is audited; the OTP issuance is not.
- **PII at rest** (GAP-5): borrower email lives in plaintext in
  `borrower_invites`, `auth.users` and `outbound_emails`.
- **Retention / offboarding export** (GAP-5) and **borrower right-to-delete**.
- **Signature AV** — `StructuralScanner` is a structural check, not ClamAV.
  A borrower-supplied PDF that is structurally clean but carries a novel
  exploit reaches the extractor. ClamAV behind the same port stays on the
  pilot-hardening list.
- **Duplicate rows on a deal** (R-4 residual): extraction is withheld, but the
  spread may briefly show two entries for the same bytes until assignment.
- **`storage.objects.metadata` behaviour** is Supabase's, not ours (R-3) —
  proven by a live smoke test, not by the harness.
