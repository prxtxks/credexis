# ADR-0001: Technology stack

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Pratik, engineering

## Context

Credexis V2 is a rebuild of UnderlyticsAI (V1). The post-mortem
(`../POSTMORTEM_V1.md`) traces V1's precision failures partly to a
Python-backend / TypeScript-frontend split that produced **three divergent
DSCR/cash-flow implementations** (trap 3) and float-based money math (trap 5).
The Blueprint (`../ARCHITECTURE.md` §9, §10) sets the design principles this
stack must satisfy: one language, one calc engine, exact integer-cents money,
durable resumable pipeline jobs, RLS-backed multi-tenancy, and a golden-corpus
eval gate. This ADR records the foundational stack chosen in M0.

## Decision

A **single-language TypeScript monorepo** (pnpm + Turborepo, TS strict):

| Layer           | Choice                                                             |
| --------------- | ------------------------------------------------------------------ |
| Monorepo        | pnpm workspaces + Turborepo, TypeScript strict                     |
| Frontend        | Next.js (App Router) + React + shadcn/ui + AG Grid + Tailwind v4   |
| API             | Next.js route handlers + tRPC                                      |
| Jobs / pipeline | Trigger.dev v4 (durable, resumable, Realtime progress)             |
| DB / ORM        | Postgres (Supabase) + Drizzle                                      |
| Storage         | Supabase Storage (per-tenant prefixes, signed URLs)                |
| Extraction      | ExtractorAdapter → Reducto + Azure prebuilt-tax + Anthropic vision |
| Transcripts     | TranscriptProvider → TaxStatus / Halcyon-class                     |
| Money math      | bigint integer cents + fixed-point decimal utility                 |
| XLSX            | exceljs                                                            |
| Observability   | Sentry + structured logs + per-run cost tracking                   |
| Hosting         | Vercel + Trigger.dev cloud + Supabase                              |

## Alternatives considered

- **Python backend (kept from V1)** — rejected: the split language is the root
  cause of V1's triplicated metric logic (trap 3).
- **Celery/Redis self-managed queues** — rejected: V1's ops burden, no
  durability. Trigger.dev gives Temporal-grade reliability without the ops.
- **Temporal** — rejected: overkill for a 2-person team.
- **LangChain-style frameworks** — rejected: indirection without benefit; we
  call vendor SDKs directly behind thin adapters.
- **Fine-tuned custom extraction models** — rejected: buy, don't build, until
  volume justifies it.

## Consequences

- **Positive:** one language kills the divergent-logic bug class; end-to-end
  types; ideal for Claude Code; all vendors are SOC 2, zero-ops MVP.
- **Trade-offs:** Next.js/tRPC couples app + API in one deploy for the MVP
  (a Hono split is a documented future seam); reliance on managed vendors
  (Supabase, Trigger.dev, Vercel) for availability.
- **Follow-ups:** ADR-0002 selects the primary extraction vendor from the M3.4
  bake-off; ADR-0003 selects the transcript provider (M9.1).
