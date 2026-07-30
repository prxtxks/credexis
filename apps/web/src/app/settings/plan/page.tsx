"use client";

/**
 * Settings → Plan & Usage (ui-17-settings; Pratik decision D1: read-only,
 * no payment UI, no Stripe — contract customers do not self-serve).
 *
 * Every number is real: deal count from deals.board, extraction spend from
 * pipeline.costs. The feature list states what the product includes today —
 * product facts, not invented usage. Invoices is an honest empty state.
 */

import { Check } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { AppShell } from "@/components/app-shell";
import { formatMicroUsd } from "@/lib/money-display";
import { SettingsCard } from "@/components/ui/settings-card";
import { Skeleton } from "@/components/ui/skeleton";

const INCLUDED = [
  "Unlimited team members",
  "Dual-reader consensus extraction",
  "Blocking validation gates (G1–G6)",
  "Borrower portal with per-invite limits",
  "Tamper-evident audit trail",
  "Banker-grade XLSX exports",
];

export default function SettingsPlanPage() {
  const board = trpc.deals.board.useQuery();
  const costs = trpc.pipeline.costs.useQuery(undefined, { staleTime: 60_000 });

  const dealCount = board.data?.length;
  const totalMicro = costs.data?.reduce((acc, d) => acc + BigInt(d.totalMicroUsd), 0n);

  return (
    <AppShell breadcrumb="Settings · Plan & Usage">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="text-title">Plan &amp; Usage</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What this workspace includes and what it has consumed.
        </p>

        <div className="mt-6 space-y-6">
          <SettingsCard
            title="Pilot"
            description="Every feature is included while Credexis is in pilot. Contract pricing (annual deal-file plans for banks, per-deal for brokers) arrives with billing — there is nothing to pay here yet."
            footer="Questions about pricing? That conversation happens with us, not a checkout page."
          >
            <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {INCLUDED.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm">
                  <span className="bg-primary/80 flex size-4 shrink-0 items-center justify-center rounded-full">
                    <Check aria-hidden="true" className="size-2.5 text-white" strokeWidth={3} />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </SettingsCard>

          <SettingsCard title="Usage" description="Live totals for this workspace.">
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-[13px]">Deal files</dt>
                <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">
                  {dealCount === undefined ? <Skeleton className="h-5 w-10" /> : dealCount}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-[13px]">Extraction spend (all time)</dt>
                <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">
                  {totalMicro === undefined ? (
                    <Skeleton className="h-5 w-16" />
                  ) : (
                    formatMicroUsd(totalMicro.toString())
                  )}
                </dd>
              </div>
            </dl>
          </SettingsCard>

          <SettingsCard title="Invoices">
            <div className="flex flex-col items-center py-8 text-center">
              <p className="text-[15px] font-semibold">No invoices</p>
              <p className="text-muted-foreground mt-1 max-w-sm text-[13px]">
                Billing arrives with contracts — invoices will land here when there is something to
                invoice.
              </p>
            </div>
          </SettingsCard>
        </div>
      </main>
    </AppShell>
  );
}
