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

| Service                     | Status            | Notes                                                                                    |
| --------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| Supabase (fresh project)    | ✅ Live           | Org `Credexis`, project `Credexis Web App`, us-east-2, Postgres 17. Fresh — no V1 reuse. |
| Vercel                      | ☐ Not provisioned |                                                                                          |
| Trigger.dev org             | ☐ Not provisioned |                                                                                          |
| Sentry                      | ☐ Not provisioned |                                                                                          |
| Anthropic API (ZDR tier)    | ☐ Not provisioned | Zero-data-retention required (tax PII).                                                  |
| Reducto                     | ☐ Not provisioned | Primary extractor candidate (M3.4).                                                      |
| Extend                      | ☐ Not provisioned | Bake-off candidate.                                                                      |
| Azure Document Intelligence | ☐ Not provisioned | Prebuilt-tax for 1040 family.                                                            |
| Transcript provider (M9)    | ☐ Not provisioned | TaxStatus / Halcyon-class.                                                               |

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
