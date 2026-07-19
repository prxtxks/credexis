# Runbook — Incident response (M10.4)

## Severity

| Sev | Definition                                                           | Examples                                        | Response                                              |
| --- | -------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| 1   | Data breach / cross-tenant exposure / wrong values reaching a lender | RLS bypass, tampered doc passing gates silently | Immediately: contain, rotate, notify affected tenants |
| 2   | Product down or pipeline halted                                      | auth outage, deploy loop                        | Same day                                              |
| 3   | Degraded (one stage failing, cost anomaly)                           | vendor API down, $/deal spike on /costs         | Next business day                                     |

## First hour (sev 1–2)

1. **Contain**: revoke the implicated credential(s) — every key is
   independently revocable (see access-review inventory). Supabase PAT and
   service keys rotate from the dashboard/Management API; Vercel env vars
   redeploy instantly.
2. **Assess blast radius**: `audit_log` (actor + before/after on every
   fact mutation), Sentry (PII-stripped errors, `pipeline` env), Vercel
   request logs, `/costs` for anomaly shape, `extraction_runs.error`.
3. **Stop the bleeding**: Vercel rollback for app regressions; disable the
   implicated deal-level feature flag (e.g. `transcripts_enabled`); pause
   Trigger.dev tasks from its dashboard.
4. **Communicate**: single owner ([PRATIK]) notifies affected tenants for
   sev 1 within the window the (future) DPA commits to.

## After

- Post-mortem within 48h using `docs/POSTMORTEM_V1.md` as the format
  precedent: timeline, root cause, blast radius, what CI/gates should have
  caught, action items as tasks.
- Key rotation completes even if the leak is "probably fine" — that rule
  exists because of the V1 GCP key (post-mortem §0).
- If data restore was involved, append actuals to the restore-drill log.
