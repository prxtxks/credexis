# Design: Borrower Portal, Notification Center, Entity↔Document Validation

**Status:** Proposed · **Targets:** MVP 3 ("The whole deal file", `docs/ROADMAP.md` Part 2) · **Companion:** `docs/ARCHITECTURE.md` §2/§5, `CLAUDE.md` iron laws
**Grounded in (read, not inferred):** `packages/schema/drizzle/0000–0009`, `packages/pipeline/src/ingest.ts`, `packages/pipeline/src/extract-stage.ts`, `packages/pipeline/src/supabase.ts`, `packages/pipeline/src/trigger/ingest-document.ts`, `packages/extraction/src/split/{classify,group}.ts`, `packages/extraction/src/statements/taxonomy-mapper.ts`, `apps/web/src/server/trpc/{context,init}.ts`, `apps/web/src/server/trpc/routers/{assignment,issues,review}.ts`, `apps/web/src/server/assignment/logic.ts`, `apps/web/src/lib/doc-checklist.ts`, `apps/web/src/app/deals/[dealId]/documents/page.tsx`

## 0. Current-state findings this design builds on (and one correction)

1. **Borrower-shaped users already have a defined security posture.** `0002_auth-wiring.sql` states: "Signed-in users without a profile get nothing — every RLS policy resolves `current_tenant_id()` to NULL for them, which matches no rows." Borrowers are exactly this class of `auth.users` — we never create a `profiles` row for them, so the entire existing org surface (deals, facts, issues, metrics, storage) is closed to them by construction, not by discipline. Every borrower capability below is an explicit, additive policy.
2. **Audit machinery is reusable as-is.** `audit_record()` (`0004`) is a SECURITY DEFINER trigger that sees every mutation path; `0005` already extended it to `logical_documents` for assignment decisions. New tables join the audited spine with one `CREATE TRIGGER` each. Direct `audit_log` inserts are revoked from every API-reachable role.
3. **Storage is prefix-keyed and immutable.** `0003_storage-layout.sql`: key convention `<tenant_id>/deals/<deal_id>/uploads/<sha256>.<ext>`, first segment always tenant id, no UPDATE policy, insert restricted to `admin`/`underwriter`. Borrower upload gets its own prefix + policies; nothing existing is loosened.
4. **Correction to the brief:** `entity_hint` is **not** on `PageClassification` (`classify.ts` — that type is `{page, formFamily, taxYear, isDocumentStart, confidence, method, matched}`). It lives on `LogicalDocumentSpan.entityHint` in `packages/extraction/src/split/group.ts`, produced deterministically by `detectEntityHint()` (regex `ENTITY_RE` over first-page text). **It is currently dropped at persistence**: `runIngest` (`ingest.ts:127–135`) inserts logical documents without it, and `logical_documents` has no column for it. Persisting this hint is step one of Design 3.
5. **Extraction already has an entity gap this design closes.** `extract-stage.ts:140–149`: docs in multi-entity deals with `entity_id IS NULL` are skipped ("no entity assigned (multi-entity deal — assign in M6.5 UI)"). Identity matching auto-fills that hole for the high-confidence band.
6. **The confidence scorer already has the blocking hook we need.** `FieldSignals.gateBlocked` (`extract-stage.ts:306–313`): "A field implicated by a violated registry relation can never auto-accept." G7 identity conflicts reuse this exact mechanism.
7. **`facts.value_cents` is `bigint NOT NULL`** — extracted _names_ can never be facts (Iron Law #2: a fact is money). Identity strings need their own lineage-carrying table (Design 3).
8. **Precedent for deterministic fuzzy matching exists**: `taxonomy-mapper.ts` ships a hand-rolled `levenshtein`/`similarity` with the ≥0.95 bar. The name matcher follows the same "deterministic code, exhaustively tested" pattern but must live somewhere the web app can import without dragging vendor SDKs (see §3.4).

---

## 1. Borrower portal

### 1.1 App placement: separate app `apps/portal` (recommended)

The roadmap already earmarks this (`docs/ROADMAP.md` MVP 3 table: "borrower-portal app (`apps/portal`, separate auth surface, magic links, upload-only RLS role)"). Beyond the roadmap, the reasons to prefer a separate Next.js app over a route-group in `apps/web`:

- **Bundle-level blast-radius isolation.** The portal deployment physically contains no underwriting routers, no spread components, no AG Grid, no metrics code. A route-group shares one tRPC root and one middleware chain; a single mis-scoped import or a missed middleware matcher exposes org surface. With a separate app the failure mode does not exist.
- **Different auth contract.** `apps/web`'s `protectedProcedure` requires a `profiles` row (`init.ts:16–24`). Borrowers must never have one. A route-group would force every procedure to branch on "org user vs borrower"; a separate app gets its own tiny context (`borrowerProcedure`) with no role ladder at all.
- **Separate origin.** Deploy at `portal.<domain>` so org session cookies and borrower session cookies never share a cookie scope, and the org app's middleware can keep redirecting profile-less users unconditionally.
- Cost: some duplicated shadcn primitives and a second Vercel project. Acceptable; extract `packages/ui` later if it itches.

Both apps use the same Supabase project (one `auth.users` namespace). A borrower session presented to `app.<domain>` fails `protectedProcedure` with "no workspace assigned"; an org session presented to the portal sees only what borrower RLS grants (nothing — no invite row binds to their uid).

### 1.2 Auth: Supabase email OTP (magic link), never org membership

- Underwriter creates a **borrower invite** bound to `(deal, entity, email)`. Portal sign-in sends `signInWithOtp` to that email only (portal server initiates; the borrower types their email, server verifies an active invite exists for it before sending — no open signup).
- First successful sign-in binds `borrower_invites.auth_user_id = auth.uid()` (server-side, after verifying the authenticated email equals the invite email).
- No `profiles` row is ever created. `current_tenant_id()` and `current_user_role()` return NULL for borrowers forever.

### 1.3 Schema (migration `0011_borrower-portal.sql`, DDL sketch)

```sql
CREATE TYPE "public"."borrower_invite_status" AS ENUM('pending','active','revoked','expired');
CREATE TYPE "public"."document_request_status" AS ENUM('open','fulfilled','withdrawn');

CREATE TABLE "borrower_invites" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"    uuid NOT NULL REFERENCES tenants(id),
  "deal_id"      uuid NOT NULL REFERENCES deals(id),
  "entity_id"    uuid NOT NULL REFERENCES entities(id),   -- the borrower speaks FOR this entity
  "email"        text NOT NULL,
  "auth_user_id" uuid,                                    -- bound on first sign-in; FK to auth.users
  "status"       borrower_invite_status DEFAULT 'pending' NOT NULL,
  "invited_by"   uuid,                                    -- profiles.id (plain uuid, like deals.created_by)
  "expires_at"   timestamptz NOT NULL,                    -- default now() + interval '30 days'
  "last_reminded_at" timestamptz,
  "created_at"   timestamptz DEFAULT now() NOT NULL,
  "revoked_at"   timestamptz
);
CREATE UNIQUE INDEX borrower_invites_live_unique
  ON borrower_invites (deal_id, entity_id, lower(email))
  WHERE status IN ('pending','active');
CREATE INDEX borrower_invites_auth_user_idx ON borrower_invites (auth_user_id);

-- Messaging seam (MVP 3.5): "request more info" notes, checklist-linked or free-form.
CREATE TABLE "document_requests" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"     uuid NOT NULL REFERENCES tenants(id),
  "deal_id"       uuid NOT NULL REFERENCES deals(id),
  "entity_id"     uuid REFERENCES entities(id),
  "invite_id"     uuid REFERENCES borrower_invites(id),   -- null = visible to all invites on the deal
  "checklist_key" text,                                   -- matches ChecklistItem label key, or null for free-form
  "note"          text NOT NULL,                          -- curated text; author knows the borrower reads it
  "status"        document_request_status DEFAULT 'open' NOT NULL,
  "fulfilled_by_document_id" uuid REFERENCES documents(id),
  "requested_by"  uuid,
  "created_at"    timestamptz DEFAULT now() NOT NULL,
  "resolved_at"   timestamptz
);

-- Borrower uploads reuse the documents table (one pipeline, one lineage root).
ALTER TABLE "documents" ADD COLUMN "uploaded_via_invite_id" uuid REFERENCES borrower_invites(id);

-- Outbound email audit (chasing + notification emails; not user-visible).
CREATE TABLE "outbound_emails" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"  uuid NOT NULL REFERENCES tenants(id),
  "kind"       text NOT NULL,             -- 'borrower_reminder' | 'notification_immediate' | 'notification_digest'
  "to_email"   text NOT NULL,
  "invite_id"  uuid REFERENCES borrower_invites(id),
  "recipient_profile_id" uuid,
  "subject"    text NOT NULL,
  "provider_message_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

-- Join the audited spine (0004 mechanism, 0005 precedent):
CREATE TRIGGER borrower_invites_audit  AFTER INSERT OR UPDATE OR DELETE ON borrower_invites
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();
CREATE TRIGGER document_requests_audit AFTER INSERT OR UPDATE OR DELETE ON document_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();
```

`ChecklistItem` data (`apps/web/src/lib/doc-checklist.ts`) moves to `packages/shared/src/checklist.ts` in the same PR (it is dependency-free display data; both apps import it; Iron Law #10 — docs and the M8.7 dashboard import path updated in the same PR).

### 1.4 Borrower RLS — the complete enumeration

Helper (SECURITY DEFINER, same pattern as `current_tenant_id()` in `0001`):

```sql
CREATE OR REPLACE FUNCTION public.my_active_invites()
RETURNS SETOF public.borrower_invites
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.borrower_invites
  WHERE auth_user_id = auth.uid() AND status = 'active' AND expires_at > now()
$$;
REVOKE EXECUTE ON FUNCTION public.my_active_invites() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.my_active_invites() TO authenticated;
```

Policies granted to borrowers (all `TO authenticated`; org users match them vacuously because their uid is on no invite):

```sql
-- 1. Own invite rows (portal needs deal/entity refs + expiry to render).
CREATE POLICY borrower_invites_select_own ON borrower_invites
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

-- 2. Own uploads, and ONLY own uploads (never the org's or other borrowers').
CREATE POLICY documents_borrower_select_own ON documents
  FOR SELECT TO authenticated USING (uploaded_by = auth.uid());

-- 3. Upload-only insert, pinned to the invite's deal and tenant.
CREATE POLICY documents_borrower_insert ON documents
  FOR INSERT TO authenticated WITH CHECK (
    uploaded_by = auth.uid()
    AND uploaded_via_invite_id IN (SELECT id FROM public.my_active_invites())
    AND deal_id   = (SELECT deal_id   FROM public.my_active_invites() i WHERE i.id = uploaded_via_invite_id)
    AND tenant_id = (SELECT tenant_id FROM public.my_active_invites() i WHERE i.id = uploaded_via_invite_id)
  );

-- 4. Requests addressed to them (or deal-wide).
CREATE POLICY document_requests_borrower_select ON document_requests
  FOR SELECT TO authenticated USING (
    deal_id IN (SELECT deal_id FROM public.my_active_invites())
    AND (invite_id IS NULL OR invite_id IN (SELECT id FROM public.my_active_invites()))
  );

-- 5. Storage: distinct borrower prefix, insert + own-select, no update/delete (immutable, per 0003).
--    Key: <tenant_id>/deals/<deal_id>/borrower-uploads/<invite_id>/<sha256>.<ext>
CREATE POLICY deal_documents_borrower_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'deal-documents'
    AND (storage.foldername(name))[3] = 'borrower-uploads'
    AND (storage.foldername(name))[4]::uuid IN (SELECT id FROM public.my_active_invites())
    AND (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.my_active_invites() i
                                          WHERE i.id = (storage.foldername(name))[4]::uuid)
  );
CREATE POLICY deal_documents_borrower_select_own ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'deal-documents'
    AND (storage.foldername(name))[3] = 'borrower-uploads'
    AND (storage.foldername(name))[4]::uuid IN (SELECT id FROM public.my_active_invites())
  );
```

Org-side policies on the new tables follow the standard `0001` pattern (`tenant_id = current_tenant_id()`, writes require `admin`/`underwriter`) — omitted here for brevity but included in the migration.

**Deliberately absent:** any borrower policy on `deals`, `entities`, `logical_documents`, `pages`, `facts`, `issues`, `computed_metrics`, `addbacks`, `loan_scenarios`, `extraction_runs`, `audit_log`, `profiles`, `tenants`, `notifications`. Deny-by-default (`0001`) makes absence sufficient.

**Curated status + checklist via one definer RPC** (borrowers get no row access to `deals`; the internal `deal_status` enum never leaves the database on a borrower call):

```sql
CREATE OR REPLACE FUNCTION public.borrower_portal_state(p_invite uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
-- Verifies p_invite ∈ my_active_invites(); returns ONLY:
--   { deal_name, coarse_status, checklist: [{key, label, satisfied}], open_requests: [...] }
-- coarse_status mapping (curated, never internal pipeline detail):
--   deals.status = 'complete'                         -> 'complete'
--   any open document_requests for this invite/deal    -> 'needs_more_docs'
--   any checklist item unsatisfied AND status='intake' -> 'received'
--   otherwise ('parsing' | 'review' | satisfied intake)-> 'in_review'
-- checklist satisfaction = EXISTS logical_documents on the deal whose form_family
-- is in the item's formFamilies (labels seeded from packages/shared checklist data).
$$;
```

(Checklist form-family sets are passed in by the portal server from `packages/shared/checklist` rather than duplicated in SQL — the function takes them as a jsonb argument; SQL only evaluates EXISTS. Client renders; server curates; DB enforces the invite check.)

### 1.5 Upload flow

Mirrors `apps/web`: portal page posts `FormData` to `apps/portal/app/api/upload` (same shape as the flow in `documents/page.tsx:97–119`). The route handler runs with the **borrower's JWT** (anon key + session — RLS applies; no service-role key in any request path, Iron Law #7): verify active invite → sha256 → storage upload under the borrower prefix → `documents` insert with `uploaded_by = auth.uid()`, `uploaded_via_invite_id` → trigger `ingest-document` via the Trigger.dev client (task-trigger secret is not a DB credential) → `notify()` fan-out (§2.4). Duplicate handling reuses the `documents_deal_sha256_unique` index (`0003:1`) → 409 → "already received".

### 1.6 Automated chasing (Trigger.dev scheduled task)

`packages/pipeline/src/trigger/chase-borrowers.ts` — `schedules.task({ cron: "0 14 * * *" })` (worker context; service-role is legal here per the header comment in `pipeline/src/supabase.ts`):

1. Select active, unexpired invites on non-complete deals.
2. Compute unsatisfied checklist items (same shared checklist data + `logical_documents` form families) and open `document_requests`.
3. Cadence gate: remind at T+3d, T+7d, then weekly (`last_reminded_at`); stop when satisfied, deal complete, invite revoked/expired.
4. Send via an `EmailPort` adapter (Resend/Postmark-class behind an interface, same pattern as `VirusScanner` in `pipeline/src/ports.ts`); log to `outbound_emails`; stamp `last_reminded_at`.
5. Flip `status='expired'` on past-`expires_at` invites (and notify the inviter, §2.4).

Pure cadence/selection logic lives in a unit-tested module; the trigger file stays a thin binding, per the `ingest-document.ts` pattern.

### 1.7 Blast radius if a magic link leaks

A leaked link (pre-consumption) or hijacked session authenticates as that borrower `auth.users` row. Reachable, exhaustively (union of §1.4 policies):

| Surface                                | Exposure                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `borrower_invites` (own rows)          | own email, deal_id/entity_id UUIDs, expiry                                                                               |
| `documents` (`uploaded_by = uid`)      | metadata of **files this borrower uploaded**                                                                             |
| `storage.objects` borrower prefix      | **bytes of files this borrower uploaded** — the real exposure: their own tax returns                                     |
| `borrower_portal_state()`              | deal display name, coarse status, checklist labels + satisfied booleans                                                  |
| `document_requests` (theirs/deal-wide) | request note text (authors are told it is borrower-visible)                                                              |
| Write ability                          | upload files into one deal (virus-scanned, MIME/size-limited by the bucket, immutable, audited via `documents`/pipeline) |

**Not reachable:** facts, spreads, metrics, issues, addbacks, loan scenarios, logical documents/pages, IRS transcript data, other borrowers' uploads or existence, org member identities, any other deal or tenant, `audit_log`. Cross-checks: `current_tenant_id()` is NULL (no profile), storage org prefix requires `current_user_role()` (`0003:44–50`), and no borrower policy references any underwriting table.

Mitigations: OTP links single-use with short expiry (Supabase config); portal session JWT lifetime short (hours, not weeks) with refresh capped well below `expires_at`; email-binding check at first sign-in; `expires_at` on every invite; **revocation is immediate** (every policy routes through `my_active_invites()`, which re-checks `status`/`expires_at` per statement); OTP issuance rate-limited; org notified on first borrower sign-in (`consent_status`-style event, §2.4); all invite lifecycle transitions audited by trigger.

---

## 2. Notification center

### 2.1 Schema (migration `0010_notifications.sql`)

```sql
CREATE TYPE "public"."notification_state" AS ENUM('unread','read','actioned','dismissed');

CREATE TABLE "notifications" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"     uuid NOT NULL REFERENCES tenants(id),
  "recipient_id"  uuid NOT NULL,                -- profiles.id (org users only; borrowers get email, never rows)
  "type"          text NOT NULL,                -- app-validated registry (zod enum), not a PG enum: types churn
  "deal_id"       uuid REFERENCES deals(id),
  "entity_id"     uuid REFERENCES entities(id),
  "logical_document_id" uuid REFERENCES logical_documents(id),
  "fact_id"       uuid REFERENCES facts(id),
  "issue_id"      uuid REFERENCES issues(id),
  "title"         text NOT NULL,
  "body"          text,
  "action_url"    text,                          -- app-relative path only; never absolute (no open-redirect surface)
  "state"         notification_state DEFAULT 'unread' NOT NULL,
  "dedupe_key"    text,                          -- e.g. 'entity_match:<logical_document_id>'
  "email_sent_at" timestamptz,                   -- digest/immediate bookkeeping
  "created_at"    timestamptz DEFAULT now() NOT NULL,
  "read_at"       timestamptz,
  "actioned_at"   timestamptz
);
CREATE INDEX notifications_recipient_unread_idx
  ON notifications (recipient_id, created_at DESC) WHERE state = 'unread';
CREATE UNIQUE INDEX notifications_dedupe_live
  ON notifications (recipient_id, dedupe_key) WHERE state = 'unread' AND dedupe_key IS NOT NULL;
CREATE INDEX notifications_digest_idx
  ON notifications (recipient_id) WHERE state = 'unread' AND email_sent_at IS NULL;
```

`type` is text validated by a zod registry in code (vs. the codebase's usual PG enums): notification types are display metadata that will grow with every feature, not a DB invariant like `fact_status`; avoiding an `ALTER TYPE` migration per feature is worth the deviation. (Flagged in open questions.)

### 2.2 RLS + write path

```sql
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select_own ON notifications
  FOR SELECT TO authenticated
  USING (recipient_id = auth.uid() AND tenant_id = public.current_tenant_id());

-- Recipients may only change state fields; payload is immutable (BEFORE trigger guards columns).
CREATE POLICY notifications_update_own ON notifications
  FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid() AND tenant_id = public.current_tenant_id());

CREATE FUNCTION public.notifications_guard() RETURNS trigger ... $$
  -- reject changes to any column except state/read_at/actioned_at;
  -- enforce transitions: unread -> read|actioned|dismissed; read -> actioned|dismissed; actioned/dismissed terminal.
$$;
CREATE TRIGGER notifications_guard BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_guard();
```

**No authenticated INSERT policy.** Fan-out targets _other_ users, so callers can't insert directly under RLS. All creation goes through one SECURITY DEFINER function:

```sql
CREATE FUNCTION public.notify(
  p_recipients uuid[], p_type text, p_title text, p_body text,
  p_action_url text, p_dedupe_key text,
  p_deal uuid, p_entity uuid, p_logical_document uuid, p_fact uuid, p_issue uuid
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  -- Guards (deterministic, inside the definer):
  --  * caller is (a) an org member whose current_tenant_id() owns p_deal, OR
  --    (b) a borrower with an active invite on p_deal (portal upload fan-out), OR
  --    (c) the worker role (session without JWT: auth.uid() IS NULL AND current_user = 'credexis_worker').
  --  * every recipient is a profile of the deal's tenant.
  --  * ON CONFLICT (dedupe_live index) DO NOTHING.
$$;
GRANT EXECUTE ON FUNCTION public.notify(...) TO authenticated, credexis_worker;
```

This is the request-path-compatible mechanism (Iron Law #7: no service-role key in request paths — tRPC mutations and the portal upload route call `notify()` under the caller's own JWT). Pipeline tasks (worker context) may call it via their service client, which is legal background use per `pipeline/src/supabase.ts`.

Notifications are **not** on the audited spine: they are ephemeral operational pointers; the actions taken from them (fact accepts, assignments, addback decisions) are already audited by the `0004`/`0005` triggers on their own tables.

### 2.3 Fan-out rules

Recipient note: there is no per-deal assignee model today (`deals` has only `created_by`). Rule below: **owner** = `deals.created_by` when it resolves to a live profile, else all `admin`/`underwriter` profiles of the tenant (open question §5.1).

| Event                                                                  | Emitted from                                                               | Recipients    | `dedupe_key`                         | Email class                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------- | ------------------------------------ | ---------------------------------- |
| Review queue over threshold (> N suggested facts after an extract run) | extract-stage completion (worker)                                          | owner         | `review_backlog:<deal>`              | daily digest                       |
| Entity-name mismatch approval (mid band, §3.6)                         | identity substage (worker)                                                 | owner         | `entity_match:<logical_document_id>` | **immediate**                      |
| Gate failure (new `issues` row, severity ≥ error)                      | recompute gate run (server flow, cf. `recomputeDeal` calls in `review.ts`) | owner         | `issue:<issue_id>`                   | immediate if critical, else digest |
| Borrower upload                                                        | portal upload route (`notify()` under borrower JWT)                        | owner         | none (each upload notifies)          | digest                             |
| Addback suggestion written (M7.3 flow)                                 | suggestion writer                                                          | owner         | `addbacks:<deal>`                    | digest                             |
| Consent status change (8821 signed/declined — M9 seam)                 | transcript webhook task (worker)                                           | owner         | `consent:<entity>`                   | digest                             |
| Member joined tenant (profile created)                                 | admin invite flow                                                          | tenant admins | none                                 | digest                             |
| Borrower invite expired / first sign-in                                | chase task / portal auth callback                                          | inviter       | `invite:<invite_id>`                 | digest                             |

### 2.4 tRPC surface (`apps/web/src/server/trpc/routers/notifications.ts`)

```
notifications.list({ cursor?, states?: ('unread'|'read'|'actioned'|'dismissed')[] }) -> { items, nextCursor }   [protectedProcedure]
notifications.unreadCount() -> { count }                                                                       [protectedProcedure]
notifications.markRead({ ids: uuid[] })                                                                        [protectedProcedure]
notifications.markAllRead()                                                                                    [protectedProcedure]
notifications.dismiss({ id: uuid })                                                                            [protectedProcedure]
```

All are recipient-scoped by RLS; `viewer` role included (reading your own notifications is not a write to underwriting data). **There is no `markActioned` endpoint**: `actioned` is set server-side by the acting mutation itself (e.g. `identity.approve` flips the `entity_match:<ld>` notification for all recipients via a definer helper `mark_actioned(dedupe_key)`), so the state means "the thing was done", not "someone clicked".

### 2.5 Realtime: poll now, keep the table transport-agnostic

Recommendation: **polling** — `unreadCount` on a 30s `refetchInterval` + refetch on window focus; panel contents fetched on open. Rationale: the codebase's live-progress pattern is already polling (2.5s in `documents/page.tsx:89–90`) with Trigger.dev Realtime slated to replace it in M8.8; Supabase Realtime `postgres_changes` would add a second push transport, another connection to manage, and RLS-replication configuration for a UX delta of seconds on a workflow measured in minutes. Nothing in the schema binds to the transport; revisit alongside the M8.8 realtime work and adopt whichever push channel wins there.

### 2.6 Email seam + retention

- **Immediate class** (`entity_match_approval`, critical `gate_failure`): the emitting flow enqueues a `send-notification-email` Trigger.dev task after `notify()` (never a synchronous SMTP call in a request path); the task renders, sends via `EmailPort`, stamps `email_sent_at`, logs `outbound_emails`.
- **Digest**: scheduled task (daily, tenant-local morning — timezone home is an open question) selects `state='unread' AND email_sent_at IS NULL` per recipient, sends one grouped email, stamps `email_sent_at`. Users who saw it in-app before the digest window simply drop out (their rows are `read`).
- **Retention** (scheduled purge task): `read`/`actioned`/`dismissed` rows deleted after 90 days; `unread` older than 180 days auto-dismissed then purged next cycle. Notifications are pointers, not records — the audit trail lives in `audit_log` (per-tenant retention windows, Blueprint §11, apply there, not here).

### 2.7 UI

Bell + unread badge in `AppHeader` (`apps/web/src/components/app-header.tsx`, already mounted on every deal page). Panel: popover list, newest first, grouped by deal; item = title, body, relative time, state chip; click navigates `action_url` and marks read; "mark all read" affordance; `actioned` items render with a check ("Approved by you · 2h"). Empty/dismissed states per the V1 palette (Blueprint §8.1).

---

## 3. Entity↔document validation ("is this 1040 actually John Smith's?")

### 3.1 Placement: an `identity` substage inside the extract stage

Runs in `runExtractStage` (`extract-stage.ts`), per logical document, **before** the existing entity-resolution check at lines 140–149 — so a high-confidence match fills `entity_id` in the same run and extraction proceeds instead of skipping with "no entity assigned". Sequence per logical document:

1. **Locate** printed identity fields (LLM/vendor may only locate — Iron Law #1).
2. **Persist observations** to `document_identities` (lineage: page, bbox, method, run).
3. **Match deterministically** against the deal's `entities` (our code, `packages/shared`).
4. **Persist scores** to `entity_match_scores` (append-only, versioned).
5. **Apply band policy**: auto-assign / notify-for-approval / G7 blocking issue.

Zeroth input: the split stage's deterministic `entityHint` (`group.ts` `detectEntityHint`) — persisted at last (§0.4) as `logical_documents.entity_hint` and inserted as a `document_identities` row with `method='deterministic'`.

### 3.2 Locating names: existing dual-path extraction + registry `text` fields

The `registry_dtype` enum already includes `'text'` (`0000:14`). Seed identity fields per MVP family × tax year (data-work, not code-work — Blueprint §4.2):

```
f1040.taxpayer_name   (text, page_hint 1)     f1040.spouse_name (text)   f1040.ssn_last4 (text)
f1120.business_name   (text, page_hint 1)     f1120.ein         (text)
f1120s.business_name  / f1120s.ein            f1065.business_name / f1065.ein
w2.employee_name / w2.employer_name / w2.employer_ein   k1.partner_name / k1.entity_name / k1.ein
```

Both existing paths run over a **1-page slice** (page_hint), reusing `slicePdfPages` + `runExtractionPath` exactly as `extractTaxForm` does (`extract-stage.ts:248–298`) — pennies per document. Path outputs for `text` dtype bypass the money normalizer and the reconciler's cents comparison; text "consensus" = normalized-string equality of the two paths (locating confidence only — never a similarity judgment). **No facts are written**: `facts.value_cents` is `bigint NOT NULL` and names are not money; identity strings live in their own lineage table. Prompts follow the classifier's posture (`classify.ts` SYSTEM_PROMPT): return null when absent/illegible, never guess. SSN handling: extract **last 4 only** (prompt + post-filter truncation); full SSNs never leave the page image (Blueprint §11 redaction posture).

Statements (P&L/BS) have no registry; their identity signal is the deterministic `entity_hint` plus, later, letterhead capture — matcher handles the null case (unmatched → mid/low band by policy).

### 3.3 Where the score lives: new tables, not `logical_documents` columns

Scores are per **(logical_document × entity)** — a 1040 in a two-guarantor deal has ≥2 scores; columns can hold only a winner and destroy the comparison record. Append-mostly (Iron Law #5): re-runs (entity renamed, guarantor added, algorithm bumped) append rows under a new `algorithm_version`, never mutate. Migration `0012_identity.sql`:

```sql
-- Persist the currently-dropped split hint + record how assignment happened.
ALTER TABLE "logical_documents" ADD COLUMN "entity_hint" text;
CREATE TYPE "public"."entity_assignment_method" AS ENUM('identity_auto','identity_approved','human');
ALTER TABLE "logical_documents" ADD COLUMN "entity_assignment_method" entity_assignment_method;

CREATE TABLE "document_identities" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"           uuid NOT NULL REFERENCES tenants(id),
  "logical_document_id" uuid NOT NULL REFERENCES logical_documents(id),
  "kind"  text NOT NULL CHECK (kind IN
      ('taxpayer_name','spouse_name','business_name','dba_name','ein','ssn_last4')),
  "raw_text"    text NOT NULL,
  "normalized"  text NOT NULL,                  -- output of the deterministic normalizer (§3.5)
  "source_page" integer,
  "source_bbox" jsonb,
  "method"      text NOT NULL CHECK (method IN ('deterministic','vendor','llm','consensus')),
  "confidence"  real,                           -- LOCATE confidence, not match confidence
  "extraction_run_id" uuid REFERENCES extraction_runs(id),
  "created_at"  timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX document_identities_ld_idx ON document_identities (logical_document_id);

CREATE TABLE "entity_match_scores" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"           uuid NOT NULL REFERENCES tenants(id),
  "logical_document_id" uuid NOT NULL REFERENCES logical_documents(id),
  "entity_id"           uuid NOT NULL REFERENCES entities(id),
  "document_identity_id" uuid REFERENCES document_identities(id),  -- which observation scored
  "score"               real NOT NULL,          -- 0..1, deterministic
  "algorithm_version"   text NOT NULL,          -- 'name-match@1'
  "components"          jsonb NOT NULL,         -- {tokenSet, jaroWinkler, einExact, dbaVariant, ...} explainability
  "band"                text NOT NULL CHECK (band IN ('auto','review','low','conflict')),
  "created_at"          timestamptz DEFAULT now() NOT NULL,
  UNIQUE ("logical_document_id","entity_id","document_identity_id","algorithm_version")
);

-- Identity gate joins the existing gate vocabulary.
ALTER TYPE "public"."validation_gate" ADD VALUE IF NOT EXISTS 'G7';
-- (operational caveat: ADD VALUE cannot be used in the same transaction that references it;
--  keep this statement in its own migration step, per Drizzle statement-breakpoint discipline)
```

RLS: standard tenant-select pattern for org users; **no borrower policies** (identity data is underwriting data). Writes come from the worker (`credexis_worker`-style grants mirroring `0001:305–328`) — org users never write scores. No audit triggers on these two tables (machine output, reproducible from `extraction_runs`); the _decision_ writes on `logical_documents` are already audited by `0005`.

### 3.4 Where the matcher lives: `packages/shared`

`packages/shared/src/text/name-match.ts` (+ `nicknames.ts` data seam), exported from the package index. Rationale:

- `packages/shared`'s charter is exactly this: "cross-cutting primitives with zero product logic" — the deterministic number normalizer (`shared/src/normalize/number.ts`, Blueprint §4.4 "one number parser, exhaustively unit-tested") is the precedent; the name matcher is its string-typed sibling.
- **Not `packages/engine`**: the engine is the sole home of _metric_ computation (Iron Law #3), pure financial math with a versioned DAG; a string-similarity primitive there dilutes that boundary and the engine's golden-test constitution (M7.6).
- **Not `packages/extraction`** despite the `levenshtein` precedent in `taxonomy-mapper.ts`: extraction drags the Anthropic SDK and vendor adapters; `apps/web` must import the matcher too (assignment screen re-scoring preview, approve flow) and already imports `@credexis/shared` for money utils.

Consumers: the pipeline substage (authoritative scoring) and `apps/web` (display/re-run preview only — the client renders; authoritative scores are always server-written rows). Thresholds/weights are versioned constants co-located with the pipeline substage and stamped into `algorithm_version` — they are extraction tuning, not SBA policy, so they do **not** go in `policy_packs` (Iron Law #8 covers SOP thresholds only).

### 3.5 The algorithm (deterministic; LLM contributes zero arithmetic)

**Normalization** (pure function, both sides):

1. Uppercase; strip diacritics; strip punctuation (`.,'&-` → space); collapse whitespace.
2. Person names: `"LAST, FIRST"` comma form reordered; suffix tokens `JR SR II III IV` dropped into a side flag.
3. Business names: strip trailing legal suffixes from a fixed table — `LLC, L.L.C., INC, INCORPORATED, CORP, CORPORATION, CO, COMPANY, LP, L.P., LLP, PLLC, LTD, PC, PARTNERS, PARTNERSHIP` (aligned with `ENTITY_RE` in `group.ts`).
4. DBA split: `"X DBA Y"` / `"X D/B/A Y"` / `"X T/A Y"` → variant set `{X, Y}`; entity names split the same way. Score = **max over the variant cross-product**.
5. Nickname seam: injectable `NicknameTable` mapping canonical↔diminutives (`ROBERT↔BOB↔ROB`, `WILLIAM↔BILL`, …). MVP ships a small curated table; empty table = feature off, algorithm unchanged.

**Score** for a (document name, entity name) pair, both normalized:

```
tokenSet  = token-set ratio: greedy best alignment of tokens using per-token Jaro-Winkler,
            where a single-letter token matches a full token sharing its initial at 0.90,
            and nickname-table pairs match at 0.95; unmatched tokens on the SHORTER side
            penalize fully, unmatched middle tokens on the longer side penalize at 0.15 weight
            (so "JOHN H SMITH" vs "JOHN SMITH" barely dents).
jw        = Jaro-Winkler over the alphabetically-sorted joined token strings
            (order-insensitivity: "SMITH JOHN" == "JOHN SMITH").
score     = 0.6 * tokenSet + 0.4 * jw          -- clamped to [0,1]
```

**Hard signals override the blend** (deterministic, recorded in `components`):

- EIN printed on doc AND entered on entity (§5.2) AND digits equal → `score = 1.0`, `einExact: true`.
- Both present AND different → `score = min(score, 0.20)`, band = `conflict` — a strong tamper/mis-upload signal regardless of name similarity (kin to the G5 fraud posture, Blueprint §6).
- SSN-last4 analog for 1040s/guarantors.

Rationale for the blend: token-set handles the dominant real-world variance (word order, middle names/initials, dropped suffixes) which pure edit distance punishes brutally ("SMITH JOHN" vs "JOHN SMITH" is a Levenshtein disaster but a token-set identity); Jaro-Winkler adds character-level tolerance for OCR noise and short-name typos ("JON"/"JOHN") with its prefix bias suiting names specifically; the 60/40 weighting favors the structural signal. Both are standard, dependency-free, and implementable in ~150 exhaustively-tested lines — same discipline as the shared number normalizer.

**Bands** (`name-match@1` constants, tuned on the golden corpus before the auto band is enabled — never by editing ground truth, Iron Law #9):

| Band       | Range                                                     | Action                                                                                                                                                          |
| ---------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto`     | ≥ 0.93, next-best entity ≤ 0.85                           | write `entity_id` + `entity_confirmed=true` + `entity_assignment_method='identity_auto'` (audited by `0005`; actor null = system); extraction proceeds this run |
| `review`   | 0.75–0.93, or ≥0.93 with a runner-up within 0.08          | leave unassigned; `notify()` type `entity_match_approval` — "1040 (2023): JOHN H SMITH — 82% match to John Smith. Approve?"                                     |
| `low`      | < 0.75 all entities, or no identity located on a tax form | G7 issue (severity `error`), unassigned                                                                                                                         |
| `conflict` | EIN/SSN contradiction, or two entities both ≥0.90         | G7 issue (severity `critical`)                                                                                                                                  |

**Blocking semantics** reuse existing machinery — no new enforcement code:

- Unassigned docs already skip fact extraction (`extract-stage.ts:140–149`), so `review`/`low`/`conflict` naturally hold facts back.
- Sole-entity deals (where `soleEntity` defaults the assignment) with a `low`/`conflict` identity still extract, but the substage sets `gateBlocked` on that document's field signals — the confidence scorer then can never auto-accept them (`extract-stage.ts:306–313`), and the G7 issue renders in the Issues panel (G1–G5 blocking posture, Blueprint §4.5).
- Approval (`identity.approve`) or manual assignment resolves the G7 issue and enqueues extraction for that logical document.

### 3.6 Interaction with the assignment screen and `entity_hint`

`assignment.list` (`routers/assignment.ts`) grows per-row: `entityHint`, top `entity_match_scores` (score, band, components, observed name + bbox ref), and `entityAssignmentMethod`. UI: detected-identity line under each logical document ("Detected: JOHN H SMITH · p1"), match chips per candidate entity with one-click approve on `review` items, "auto-matched 96%" badge (with revert — which is just the existing `assign` mutation, already audited) on `auto` items, and a conflict banner deep-linking the G7 issue. The existing `assign` mutation is unchanged and remains the human override; `buildAssignmentPatch` gains only `entity_assignment_method='human'` stamping.

New router `identity`:

```
identity.forDeal({ dealId })                    -> observations + scores per logical document   [protectedProcedure]
identity.approve({ logicalDocumentId, entityId }) -> assignment write (entity_confirmed=true,
                                                    method='identity_approved'), G7 resolve,
                                                    mark notification actioned, enqueue extract  [underwriterProcedure]
identity.rerun({ dealId })                      -> enqueue identity substage re-run
                                                   (after entity rename / new guarantor)         [underwriterProcedure]
```

### 3.7 Test-case table (fixture spec — TDD, failing tests first per CLAUDE.md workflow)

Entity list for person cases: `John Smith` (guarantor), `Acme Corporation` (applicant, EIN 12-3456789 where noted). Approximate expected scores under `name-match@1`; exact fixture values are pinned by the tests themselves:

| Document name                  | Entity                            | Key mechanism                                  | Expected score | Band                                                            |
| ------------------------------ | --------------------------------- | ---------------------------------------------- | -------------- | --------------------------------------------------------------- |
| `JOHN SMITH`                   | John Smith                        | exact after normalize                          | 1.00           | auto                                                            |
| `JOHN H. SMITH`                | John Smith                        | extra middle token @0.15 weight                | ~0.96          | auto                                                            |
| `J SMITH`                      | John Smith                        | initial-match rule @0.90                       | ~0.82          | review — "Name matches 82% — approve?"                          |
| `SMITH JOHN`                   | John Smith                        | token-set + sorted-JW order insensitivity      | 1.00           | auto                                                            |
| `SMITH, JOHN`                  | John Smith                        | comma-form reorder                             | 1.00           | auto                                                            |
| `JON SMITH`                    | John Smith                        | nickname table (JON↔JOHN) @0.95, JW high      | ~0.90          | review                                                          |
| `ACME CORP`                    | Acme Corporation                  | suffix table strips both → `ACME` = `ACME`     | 1.00           | auto                                                            |
| `ACME CORPORATION`             | ACME CORP LLC                     | suffixes stripped bilaterally                  | 1.00           | auto                                                            |
| `Acme Corp DBA Sunrise Motel`  | Acme Corporation                  | DBA variant `{ACME, SUNRISE MOTEL}` — max wins | 1.00           | auto                                                            |
| `Acme Corp DBA Sunrise Motel`  | Sunrise Motel LLC                 | other DBA variant                              | 1.00           | auto (conflict check if both entities exist ≥0.90 → `conflict`) |
| `JANE DOE`                     | John Smith                        | no token overlap                               | <0.30          | low → G7                                                        |
| `ACME CORP` + EIN `98-7654321` | Acme Corporation (EIN 12-3456789) | EIN contradiction overrides name               | 0.20 cap       | conflict → G7 critical                                          |
| any name + EIN `12-3456789`    | Acme Corporation (EIN 12-3456789) | EIN exact                                      | 1.00           | auto                                                            |

Plus negative-control fixtures: empty identity on a P&L (hint-only path), OCR noise (`ACM3 C0RP`), and the two-guarantor 1040 with spouses (`taxpayer_name` vs `spouse_name` both scored; spouse entity kind exists in `entity_kind`).

---

## 4. Migration & rollout order

| Step | Artifact                                                                                                                                      | Depends on | Notes                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| 1    | `0010_notifications.sql` (table, RLS, guard trigger, `notify()`) + `notifications` router + bell UI                                           | —          | Ship first: Designs 1 and 3 both fan into it; useful standalone (gate failures, member joins) |
| 2    | PR: persist `entity_hint` (`0012` column part can be split forward) — `ingest.ts` passes `span.entityHint` through `insertLogicalDocument`    | —          | Fixes currently-dropped data; trivially testable (`bundle.test.ts` already asserts the hint)  |
| 3    | `packages/shared/src/text/name-match.ts` + fixture tests (§3.7)                                                                               | —          | Pure code, no schema; TDD                                                                     |
| 4    | `0012_identity.sql` (tables, G7 enum value in its own step, worker grants) + registry seed rows for identity fields                           | 3          | Registry seeding is data-work (`form_registry` rows), no new code paths                       |
| 5    | Identity substage in `extract-stage` behind a flag: locate + observe + score + `review`/`low`/`conflict` bands only (auto band **off**)       | 1, 3, 4    | Runs shadow on real deals; scores accumulate for threshold tuning against the golden corpus   |
| 6    | Assignment-screen identity UI + `identity` router; enable notifications for `review` band                                                     | 5          | Human-in-the-loop live before any auto-assignment                                             |
| 7    | Enable `auto` band after eval sign-off (auto-assign precision target set with the corpus, tracked like auto-accept precision, Blueprint §9.2) | 6          | Config flip + eval evidence in the PR                                                         |
| 8    | `0011_borrower-portal.sql` (invites, requests, storage policies, helpers, audit triggers) + move checklist data to `packages/shared`          | 1          | Same PR updates `apps/web` checklist import (Iron Law #10)                                    |
| 9    | `apps/portal` scaffold: OTP sign-in, `borrower_portal_state`, upload route, my-uploads                                                        | 8          | Pen-test the RLS enumeration (§1.4) with the RLS integration harness before exposure          |
| 10   | Chasing task + `EmailPort` + `outbound_emails`; invite lifecycle notifications                                                                | 8, 9       | Worker context                                                                                |
| 11   | `document_requests` UI both sides (MVP 3.5 messaging seam)                                                                                    | 9          | Seam only: request → portal render → upload link-back                                         |

Each step is a small PR on its own task branch (workflow law); `pnpm eval` must not regress at steps 5–7 (identity substage adds cost per document — recorded via `extraction_runs`, visible in `/costs`).

## 5. Open questions

1. **Deal ownership model.** Fan-out currently targets `deals.created_by` with an all-underwriters fallback — there is no assignee concept in the schema. Is a `deal_members`/assignee model wanted before notification volume makes the fallback noisy? **[PRATIK]**
2. **`entities.ein` / `entities.ssn_last4`.** The hard-signal tier needs them; `entities` today has only `kind/name/tax_structure`. Proposed: nullable columns, human-entered at deal creation (explicit human input — Iron Law #1 compliant). PII posture: last4-only for SSN; is full EIN acceptable in-row (it appears on every return anyway), or encrypt-at-rest column? **[PRATIK]**
3. **Notification `type` as text vs PG enum** — deviation from codebase enum style, justified in §2.1; confirm or fold to enum.
4. **Digest timing / tenant settings home.** `tenants` has no settings column; digest hour, chasing cadence, and retention windows all want a per-tenant config surface. One `tenants.settings jsonb` or a `tenant_settings` table?
5. **Checklist entity-awareness.** `checklistFor(dealType)` is deal-type-only; "Personal tax returns (guarantors)" should be satisfied per-guarantor (N guarantors → N×3 returns). Extend `ChecklistItem` with per-entity-kind cardinality, or keep MVP coarse (any 1040 satisfies)?
6. **Auto band semantics.** Proposed: `auto` sets `entity_confirmed=true` (revertible, fully audited). Alternative: auto sets `entity_id` only, leaving `entity_confirmed=false` so extraction proceeds but the UI keeps a "machine-assigned" nudge until a human touches it. Product call on how loud auto-assignment should be.
7. **Portal session lifetime.** Concrete Supabase JWT/refresh values for borrower sessions (proposal: 1h access / 24h refresh cap) vs. UX cost of re-sending magic links to non-technical borrowers. **[PRATIK]**
8. **Nickname table sourcing** — ship curated ~50-pair US list at MVP or start empty (feature dormant)?
9. **Coarse-status mapping edge**: a deal in `complete` with a still-open `document_request` — does `complete` win (proposed) or `needs_more_docs`?
10. **G7 in the `validation_gate` enum** treats identity as a first-class gate alongside G1–G6 (recommended — it renders in the existing Issues panel with zero UI plumbing, cf. `routers/issues.ts`). Alternative: a parallel issue kind. Confirm the SOC 2 / bank-audit story prefers one gate vocabulary.
