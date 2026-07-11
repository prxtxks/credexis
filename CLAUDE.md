# Credexis — SBA 7(a) Underwriting Automation

Documents in → banker-grade pro-forma out. Read /docs/ARCHITECTURE.md before
non-trivial work; /docs/POSTMORTEM_V1.md lists the traps that killed V1.
The build order lives in /docs/MASTER_TASK_LIST.md — follow it.

## Iron laws (violating any of these is a bug, even if tests pass)

1. LLMs NEVER do arithmetic and NEVER invent values. They classify labels,
   locate fields, and split documents. Every number traces to a source
   bbox, an IRS transcript line, or an explicit human input.
2. All money is integer cents (bigint) via packages/shared money utils.
   A raw `number` must never hold a monetary value.
3. packages/engine is the ONLY place metrics are computed. Server-side only.
   The client renders; it never computes. No metric math in apps/web, ever.
4. Values bind to periods/columns by geometry (bbox/cell identity),
   never by ordinal position in a list.
5. Facts are append-mostly: overrides supersede, never mutate. Lineage
   (source_doc, page, bbox, method, confidence) is required on every fact.
6. Validation gates (G1–G6) are blocking: failing fields cannot auto-accept.
7. Every route verifies the JWT; every tenant table has RLS; the
   service-role key never appears in a request path.
8. SBA thresholds come from the versioned policy_packs table, never
   hardcoded (SOP 50 10 8 changes; code must not).
9. Never edit golden-corpus ground truth to make an eval pass. Never
   count synthetic fixtures in accuracy claims.
10. Docs change in the same PR as behavior. Dead code is deleted the day
    it dies.

## Commands

pnpm dev / build / typecheck / lint / test — standard
pnpm eval — golden-corpus extraction scorecard (must not regress vs
eval-baseline.json; CI enforces)
pnpm db:migrate / db:seed — Drizzle migrations + taxonomy/policy seeds

## Stack

pnpm + Turborepo · Next.js App Router + tRPC · Trigger.dev v4 (pipeline)
Supabase (Postgres/Auth/Storage) + Drizzle · AG Grid · exceljs
Extraction vendors behind ExtractorAdapter (packages/extraction) —
see ADR-0002 for the selected primary.

## Workflow

- One task ID per branch (e.g. m4-3-consensus-reconciler); conventional
  commits; small PRs; task's acceptance criteria quoted in PR description.
- TDD for parsers/engine: failing fixture test first.
- [PRATIK] tasks need human input — flag and skip, never fabricate.
- Secrets: never in git; gitleaks runs in CI; \*.json keys are gitignored.
