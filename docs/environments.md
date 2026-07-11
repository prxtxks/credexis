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

| Service                     | Status            | Notes                                   |
| --------------------------- | ----------------- | --------------------------------------- |
| Supabase (fresh project)    | ☐ Not provisioned | Do NOT reuse V1's project.              |
| Vercel                      | ☐ Not provisioned |                                         |
| Trigger.dev org             | ☐ Not provisioned |                                         |
| Sentry                      | ☐ Not provisioned |                                         |
| Anthropic API (ZDR tier)    | ☐ Not provisioned | Zero-data-retention required (tax PII). |
| Reducto                     | ☐ Not provisioned | Primary extractor candidate (M3.4).     |
| Extend                      | ☐ Not provisioned | Bake-off candidate.                     |
| Azure Document Intelligence | ☐ Not provisioned | Prebuilt-tax for 1040 family.           |
| Transcript provider (M9)    | ☐ Not provisioned | TaxStatus / Halcyon-class.              |

## V1 secret hygiene (carry-over from the post-mortem)

V1 committed a **live GCP service-account key** (`*.json`) at the repo root
because `.gitignore` covered only `.env*` and `*.pem`. Required actions
(Blueprint §11, assume compromise):

1. **Revoke** the leaked GCP service-account key; audit GCP usage logs.
2. **Rotate** all V1 secrets before any are reused. Prefer fresh projects
   (fresh Supabase per M0.5) over reusing V1 infrastructure.

## Structural guardrails

- `.gitignore` ignores credential-shaped files (`*.pem`, `*.key`,
  `*credentials*.json`, `*service-account*.json`, `gcp-*.json`, `secrets/`, …)
  — filename-based defense.
- **gitleaks** runs in CI (`.github/workflows/ci.yml`, job `secret-scan`) and
  scans content, catching key material regardless of filename. Config lives in
  `.gitleaks.toml`. Run locally with `gitleaks git --redact` before pushing.
