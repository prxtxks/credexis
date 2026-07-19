# SOC 2 groundwork — Access review (M10.4)

Quarterly review of who can touch what. At today's scale (solo founder +
Claude Code agent) this is short — the point is the habit and the record.
**Start the Type I clock when the first bank pilot signs (Blueprint §11).**

## Access inventory (2026-07-19)

| System                                                      | Who                | Level         | Auth           | Notes                                              |
| ----------------------------------------------------------- | ------------------ | ------------- | -------------- | -------------------------------------------------- |
| GitHub `prxtxks/credexis` (private)                         | Pratik (`prxtxks`) | Owner         | GitHub 2FA     | Sole human collaborator                            |
| Supabase org `Credexis`                                     | Pratik             | Owner         | Supabase login | Agent operates token-only (`sbp_…` PAT, revocable) |
| Vercel `mepratikchaudhari-3919s-projects`                   | Pratik             | Owner         | GitHub SSO     | Deploys from GitHub only                           |
| Trigger.dev org                                             | Pratik             | Owner         | login          | Secret key in `.env.local`; PAT pending            |
| Vendor consoles (Anthropic, Reducto, Azure, Extend, Sentry) | Pratik             | Owner         | per-vendor     | API keys in `.env.local` only                      |
| Production data (RLS)                                       | app users          | tenant-scoped | Supabase JWT   | admin/underwriter/viewer roles; matrix test in CI  |

## Standing rules

- No shared accounts; every key is revocable independently.
- Service-role key: never in a request path (Iron Law #7); pipeline only.
- Key rotation: quarterly, and immediately after any incident or when a
  secret may have been exposed (⚠ pending: rotate the Supabase service
  keys echoed into an agent transcript pre-launch — tracked since M2).
- Offboarding (future hires): same-day revocation checklist = GitHub,
  Supabase, Vercel, Trigger.dev, vendor consoles, secret manager.

## Review log

| Date       | Reviewer                             | Outcome                    |
| ---------- | ------------------------------------ | -------------------------- |
| 2026-07-19 | Claude (agent), countersign [PRATIK] | Initial inventory recorded |
