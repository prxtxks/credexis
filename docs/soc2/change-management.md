# SOC 2 groundwork — Change management (M10.4)

All production change flows through pull requests. This document describes
the control as it actually operates.

## The control

1. **One task ID per branch** (`m10-3-security-pass`); no direct pushes to
   `main` as a working rule.
2. **CI gates on every PR** — all must pass before merge: secret scan
   (gitleaks, full history) · dependency audit (high+) · lint + format +
   client-math guard · typecheck · schema drift + RLS assertions · unit
   tests (engine coverage thresholds enforced) · build · Playwright smoke
   · eval placeholder (real corpus scorecard at M10.6) · Vercel preview
   deploy.
3. **Verified-green merge**: merges happen only after every check reports
   green (`gh pr checks` loop). Known gap: **branch protection is not
   platform-enforced** — GitHub requires Pro for private-repo protection
   rules. [PRATIK]: upgrade to make red CI physically block merges.
4. **Traceability**: PR description quotes the task's acceptance criteria;
   conventional commits; deployment attribution to `prxtxks`; DB-side
   changes are numbered migrations applied via the Management API and
   drift-checked in CI; every fact/addback/scenario/assignment mutation is
   trigger-audited with actor + before/after.
5. **Rollback**: app = Vercel instant rollback to a previous deployment;
   schema = forward-fix migrations (never edit an applied migration);
   data = `docs/runbooks/restore-drill.md`.

## Emergency change

Same flow, expedited: PR may merge with reviewer-of-one, but CI gates are
never skipped. Post-incident review within 48h (see incident runbook).
