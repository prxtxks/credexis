# Environments & Secrets

How Credexis manages configuration and secrets across environments. The
governing rule (Blueprint §11, Iron Law #7): **no secret value ever enters
git**, and the **service-role key never appears in a request path**.

## Secret management

- **Source of truth:** a team secret manager (1Password or Doppler). Local
  developers pull secrets into `.env.local` (gitignored); nothing is shared
  over chat/email.
- **Runtime injection:**
  - _App (Vercel):_ environment variables set per environment in the Vercel
    project (Production / Preview / Development).
  - _Pipeline (Trigger.dev):_ environment variables set in the Trigger.dev
    project; workers use scoped Supabase access with explicit tenant checks —
    never the service-role key in a user-facing path.
- **Template:** `.env.example` at the repo root lists every variable name with
  no values. Keep it in sync when a new variable is introduced (same PR).

## Environment matrix

| Environment | App host          | DB / Auth / Storage    | Jobs               |
| ----------- | ----------------- | ---------------------- | ------------------ |
| Local       | `next dev`        | Supabase (dev project) | Trigger.dev (dev)  |
| Preview     | Vercel Preview    | Supabase (dev project) | Trigger.dev (dev)  |
| Production  | Vercel Production | Supabase (prod)        | Trigger.dev (prod) |

## Provisioned services — status

**[PRATIK] M0.5** — fill in as each service is procured. Nothing is assumed
live until recorded here.

| Service                     | Status            | Notes                                                                                                                                 |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase (fresh project)    | ✅ Live           | Org `Credexis`, project `Credexis Web App`, us-east-2, Postgres 17. Fresh — no V1 reuse.                                              |
| Vercel                      | ✅ Live           | `credexis-web.vercel.app` — middleware auth verified in production (2026-07-18).                                                      |
| Trigger.dev org             | ✅ Live           | Secret key + project id verified (2026-07-18). `ingest-document` task built (M3.1); deploy pending `TRIGGER_ACCESS_TOKEN` ([PRATIK]). |
| Sentry                      | ☐ DSN NOT set     | M10.2 wiring is live but DSN-gated → currently inert. Paste `SENTRY_DSN` (+ `NEXT_PUBLIC_SENTRY_DSN`) to enable ([PRATIK]).           |
| Anthropic API               | ✅ Live           | Key verified (2026-07-18). ⚠️ Confirm org ZDR status before REAL tax docs ([PRATIK]).                                                 |
| Reducto                     | ✅ Live           | Key verified (2026-07-18). Primary extractor candidate (M3.4).                                                                        |
| Extend                      | ☐ Key NOT set     | `.env.local` line is an empty placeholder (audit 2026-07-19). Optional third bake-off contender.                                      |
| Azure Document Intelligence | ✅ Live           | Resource `credexis-docintel`; endpoint+key verified (2026-07-18). Prebuilt-tax for 1040.                                              |
| Transcript provider (M9)    | ☐ Not provisioned | TaxStatus / Halcyon-class.                                                                                                            |

**[PRATIK] pending review (M2.6):** policy pack `sop-50-10-8-2026-03` is
seeded with `reviewStatus: "draft"` — every threshold (DSCR 1.15/1.10, 10%
equity injection, term/guaranty limits) must be verified against the current
SOP 50 10 8 text and flipped to `reviewed`. The engine (M7) will refuse to
certify compliance under a draft pack. Taxonomy granularity (207 nodes) also
awaits the same review.

## Storage layout (M2.4)

- **Bucket:** `deal-documents` — private; 50 MiB/object cap; MIME allowlist
  (pdf, png, jpeg, tiff, xlsx, xls) enforced at the bucket level.
- **Key convention (RLS keys on the first segment = tenant id):**
  `tenant_id/deals/deal_id/uploads/<sha256>.<ext>` for uploads,
  `tenant_id/deals/deal_id/pages/<logical_doc_id>/<n>.png` for page renders.
  Keys are built ONLY by `apps/web/src/lib/storage.ts` (uploads/URLs) — never
  hand-assembled.
- **Access:** tenant members read own-tenant objects; admin/underwriter write
  own-tenant; delete admin-only; objects immutable (no UPDATE policy). File
  contents flow only through **signed URLs, TTL 120 s**, created server-side
  with the caller's RLS-scoped client. The pipeline worker role is scoped to
  this bucket only.
- **Dedupe:** `documents(deal_id, sha256)` unique constraint + content-addressed
  object keys — re-uploading identical bytes to a deal is rejected at the DB.

## Auth providers (M2.3)

- **Email/password:** enabled (Supabase default). Sign-ups do NOT get access
  by themselves: a new user has no `profiles` row, so `current_tenant_id()`
  is NULL and RLS matches zero rows; tRPC `protectedProcedure` rejects them.
  Tenant membership is granted by an admin creating the profile row (invite
  flow comes in a later milestone).
- **Google OAuth:** wired in the login page (`signInWithOAuth`), but the
  provider is **not yet configured** in Supabase — it needs a Google Cloud
  OAuth client. **[PRATIK]**: create OAuth credentials at
  console.cloud.google.com (authorized redirect URI:
  `https://<project-ref>.supabase.co/auth/v1/callback`), then share the
  client ID + secret via `.env.local` (`GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`) and I'll enable the provider via the
  Management API. Until then the Google button returns a provider-disabled
  error; email/password works.

### Supabase operations model

Schema/RLS/seeds are applied **token-only**, no dashboard login and no DB
password, via the Management API query endpoint:

- `SUPABASE_ACCESS_TOKEN` (personal access token, `sbp_…`) + `SUPABASE_PROJECT_REF`
  live in `.env.local` (gitignored).
- `pnpm db:migrate:api` applies `packages/schema/drizzle/*.sql` through the
  Management API, writing the same `drizzle.__drizzle_migrations` rows the
  native drizzle migrator writes — so `pnpm db:migrate` (direct connection)
  stays interchangeable.
- `DATABASE_URL` / `DIRECT_URL` (pooler + DB password) are **deferred** until
  the app runtime needs a Postgres connection (M2.3). Supabase never exposes
  the DB password via API; it will be reset/obtained then. Pooler host:
  `aws-1-us-east-2.pooler.supabase.com` (6543 transaction / 5432 session).

### .env.local hygiene (audit 2026-07-19)

Several template lines carry inline `# comments` after an empty value
(`EXTEND_API_KEY=            # optional`). Two consequences: (1) naive
"is it set" checks see the comment as a value — verify with real API
calls, not greps; (2) dotenv keeps unquoted trailing text, so a value
followed by an inline comment can absorb it (`NEXT_PUBLIC_APP_URL` has
one — harmless today, trap later). When filling a line, delete the
comment.

### Live test suites (opt-in, never CI)

Gated suites that touch the live project or paid vendor APIs — each skips
unless its flag is set alongside the credentials it needs in `.env.local`:

- `RUN_LIVE_VENDOR_TESTS=1 pnpm vitest run packages/extraction` — vendor
  smoke (Anthropic/Reducto/Azure read planted synthetic values; costs money).
- `RUN_LIVE_E2E=1 pnpm test:e2e` — M6.6 full review loop: seeds a deal with
  a planted G1 disagreement in the live DB, signs a GoTrue-created reviewer
  into the real UI, resolves the queue, then asserts supersession, audit
  actor, and a green gate re-run. Seeds and the reviewer are removed after.
- Integration tests (`*.integration.test.ts`) run whenever
  `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` are present.

### Observability (M10.2)

- **Sentry**: server + client SDKs are DSN-gated (`SENTRY_DSN`; mirror as
  `NEXT_PUBLIC_SENTRY_DSN` for browser capture — also in Vercel env).
  `sendDefaultPii` off; request bodies/cookies/headers stripped
  (tax PII never leaves). Pipeline tasks capture failures under the
  `pipeline` environment. Alert rules (failure rate, new issue) are
  configured in the Sentry dashboard — [PRATIK], one-time.
- **Structured logs**: pipeline tasks emit JSON lines with run/document/deal
  ids (Trigger.dev log viewer / any drain).
- **Cost dashboard**: `/costs` aggregates extraction_runs per deal — spend
  by stage, failed-run count, and a ⚠ flag over the $10/deal envelope
  (Blueprint §12). Source-map upload needs `SENTRY_ORG` / `SENTRY_PROJECT`
  / `SENTRY_AUTH_TOKEN` (optional; runtime capture works without).

## Repository & CI

- **Remote:** `github.com/prxtxks/credexis` — **private**, created fresh
  2026-07-11. No history or code from V1/UnderlyticsAI.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to
  `main`.
- **Branch protection:** _not yet enforceable_ — GitHub requires Pro (or a
  public repo) for protection rules on private repos. **[PRATIK]** upgrade to
  Pro or move the repo into an org with a paid plan to make red CI physically
  block merges. Until then the working rule is: no PR merges unless its CI run
  is green (enforced by discipline, verified per merge).

## V1 secret hygiene (carry-over from the post-mortem)

V1 committed a **live GCP service-account key** (`*.json`) at the repo root
because `.gitignore` covered only `.env*` and `*.pem`. Status (Blueprint §11):

1. ~~Revoke the leaked GCP service-account key~~ — **done automatically**:
   Google detected the public leak and revoked the key (confirmed by Pratik,
   2026-07-11).
2. **Rotate** any remaining V1 secrets before any are reused. Moot in practice:
   V2 uses all-fresh projects (fresh Supabase per M0.5) and reuses no V1
   infrastructure.

## Structural guardrails

- `.gitignore` ignores credential-shaped files (`*.pem`, `*.key`,
  `*credentials*.json`, `*service-account*.json`, `gcp-*.json`, `secrets/`, …)
  — filename-based defense.
- **gitleaks** runs in CI (`.github/workflows/ci.yml`, job `secret-scan`) and
  scans content, catching key material regardless of filename. Config lives in
  `.gitleaks.toml`. Run locally with `gitleaks git --redact` before pushing.
