"use client";

/**
 * Deal dashboard (M8.7, Blueprint §8.2): pipeline board — Intake →
 * Parsing → Review → Complete — with a doc-completeness checklist per
 * deal type, DSCR at a glance (rendered from engine strings; thresholds
 * for the traffic light come from the policy pack in the workspace), and
 * the new-deal wizard.
 */

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { checklistFor } from "@/lib/doc-checklist";
import { formatRatio } from "@/components/workspace/metrics-strip";
import { ThemeToggle } from "@/components/theme-toggle";

const COLUMNS = [
  { status: "intake", label: "Intake" },
  { status: "parsing", label: "Parsing" },
  { status: "review", label: "Review" },
  { status: "complete", label: "Complete" },
] as const;

const ENTITY_KINDS = ["applicant", "target", "guarantor", "spouse", "epc", "oc"] as const;
const DEAL_TYPES = ["business_acquisition", "working_capital", "real_estate", "refinance"] as const;

function NewDealWizard({ onDone }: { onDone: (dealId: string) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof DEAL_TYPES)[number]>("business_acquisition");
  const [entities, setEntities] = useState<{ name: string; kind: (typeof ENTITY_KINDS)[number] }[]>(
    [{ name: "", kind: "applicant" }],
  );
  const create = trpc.deals.create.useMutation({ onSuccess: (r) => onDone(r.dealId) });

  return (
    <div className="glass-card space-y-3 p-4 text-sm">
      <h2 className="font-semibold">New deal</h2>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs font-semibold">
          Deal name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Holdings acquisition"
            className="mt-0.5 w-full rounded border border-line px-2 py-1 font-normal dark:border-line-dark dark:bg-surface-dark-muted"
          />
        </label>
        <label className="block text-xs font-semibold">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as (typeof DEAL_TYPES)[number])}
            className="mt-0.5 w-full rounded border border-line px-2 py-1 font-normal dark:border-line-dark dark:bg-surface-dark-muted"
          >
            {DEAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-1">
        <span className="text-xs font-semibold">Entities</span>
        {entities.map((e, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={e.name}
              onChange={(ev) =>
                setEntities(entities.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))
              }
              placeholder="Entity legal name"
              className="w-full rounded border border-line px-2 py-1 dark:border-line-dark dark:bg-surface-dark-muted"
            />
            <select
              value={e.kind}
              onChange={(ev) =>
                setEntities(
                  entities.map((x, j) =>
                    j === i ? { ...x, kind: ev.target.value as (typeof ENTITY_KINDS)[number] } : x,
                  ),
                )
              }
              className="rounded border border-line px-2 py-1 dark:border-line-dark dark:bg-surface-dark-muted"
            >
              {ENTITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        ))}
        <button
          onClick={() => setEntities([...entities, { name: "", kind: "guarantor" }])}
          className="text-xs text-primary underline dark:text-primary-dark"
        >
          + add entity
        </button>
      </div>

      <div className="rounded bg-surface-muted p-2 text-xs dark:bg-surface-dark-muted">
        <span className="font-semibold">Document checklist for this type:</span>
        <ul className="mt-1 list-inside list-disc">
          {checklistFor(type).map((c) => (
            <li key={c.label}>{c.label}</li>
          ))}
        </ul>
      </div>

      <button
        onClick={() =>
          create.mutate({ name, type, entities: entities.filter((e) => e.name.trim() !== "") })
        }
        disabled={create.isPending || name.trim() === ""}
        className="rounded bg-primary px-3 py-1.5 text-primary-foreground dark:bg-primary-dark"
      >
        Create deal
      </button>
      {create.error && <p className="text-xs text-severity-critical">{create.error.message}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const board = trpc.deals.board.useQuery(undefined, { refetchInterval: 15_000 });
  const [showWizard, setShowWizard] = useState(false);
  const utils = trpc.useUtils();

  return (
    <main className="gradient-mesh min-h-screen p-6">
      <header className="mb-6 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Credexis — deal pipeline</h1>
        <button
          onClick={() => setShowWizard((v) => !v)}
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground dark:bg-primary-dark"
        >
          {showWizard ? "Close" : "New deal"}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-sm text-ink-muted dark:text-ink-dark-muted">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {showWizard && (
        <div className="mb-6 max-w-2xl">
          <NewDealWizard
            onDone={() => {
              setShowWizard(false);
              void utils.deals.board.invalidate();
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const deals = (board.data ?? []).filter((d) => d.status === col.status);
          return (
            <section key={col.status}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-dark-muted">
                {col.label} ({deals.length})
              </h2>
              <div className="space-y-2">
                {deals.map((d) => {
                  const checklist = checklistFor(d.type);
                  const have = checklist.filter((c) =>
                    c.formFamilies.some((f) => d.formFamilies.includes(f)),
                  );
                  return (
                    <Link
                      key={d.id}
                      href={`/deals/${d.id}/workspace`}
                      className="glass-card block p-3 text-sm hover:border-primary dark:hover:border-primary-dark"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{d.name}</span>
                        {d.dscr && (
                          <span
                            className="rounded bg-surface-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums dark:bg-surface-dark-muted"
                            title={`DSCR ${d.dscr.period}`}
                          >
                            {formatRatio(d.dscr.mantissa, d.dscr.scale)}×
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-ink-muted dark:text-ink-dark-muted">
                        {d.type.replaceAll("_", " ")}
                      </div>
                      <div className="mt-2 text-xs">
                        docs {have.length}/{checklist.length}
                        <span className="ml-2 inline-flex gap-0.5 align-middle">
                          {checklist.map((c) => (
                            <span
                              key={c.label}
                              title={c.label}
                              className={`inline-block h-1.5 w-3 rounded-sm ${
                                c.formFamilies.some((f) => d.formFamilies.includes(f))
                                  ? "bg-primary dark:bg-primary-dark"
                                  : "bg-line dark:bg-line-dark"
                              }`}
                            />
                          ))}
                        </span>
                      </div>
                    </Link>
                  );
                })}
                {deals.length === 0 && (
                  <p className="text-xs text-ink-muted dark:text-ink-dark-muted">—</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
