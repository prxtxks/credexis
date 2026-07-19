# Runbook — Supabase restore drill (M10.3)

**Goal:** prove we can recover the database from backup before real deal
data exists, and know exactly how long it takes. Execute quarterly and
after any major schema change. **[PRATIK]: first execution pending.**

## What Supabase gives us

- Free/Pro tiers: daily automated backups (Pro adds PITR as an add-on).
- Backups cover **Postgres only** — storage objects (`deal-documents`
  bucket) are durable in S3 but are NOT part of DB backups; the
  content-addressed keys in `documents.storage_path` remain valid across a
  DB restore, which is why uploads are immutable (M2.4).

## Drill procedure (staging-safe, ~30 min)

1. Note current state: `select count(*) from public.facts;` via
   `pnpm db:migrate:api`-style Management API query (see
   `docs/environments.md` → operations model).
2. Dashboard → Database → Backups → restore the most recent backup **into
   a new branch/project** (never in-place during a drill).
3. Point a local `.env.local` at the restored ref; run the verification
   battery:
   - `pnpm vitest run packages/schema` (RLS + storage integration tests)
   - `RUN_LIVE_E2E=1 pnpm test:e2e` (full product loop against the restore)
4. Record: restore duration, data delta (rows written since backup
   timestamp), any failures. File an issue for every surprise.
5. Tear the restored project down.

## Real-incident deltas

- Restore **in place** only after the incident channel agrees; RLS and
  audit trail come back with the schema (they live in migrations, which
  are re-runnable via `pnpm db:migrate:api` if ever needed).
- Rotate all keys after any incident-driven restore (see
  `docs/environments.md` → V1 key leak post-mortem).
- Storage: nothing to restore unless the bucket itself was harmed;
  object keys are content-addressed and immutable.

## RPO / RTO targets (pre-pilot)

- RPO: 24h (daily backups) — **upgrade to PITR before the first bank
  pilot** ([PRATIK], Pro add-on).
- RTO: 1h measured by this drill; record actuals here:

| Date | Restore duration | Notes               |
| ---- | ---------------- | ------------------- |
| —    | —                | first drill pending |
