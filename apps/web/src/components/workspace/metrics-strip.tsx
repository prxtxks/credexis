"use client";

/**
 * Persistent metrics strip (M8.2, Blueprint §8.2): CFADS · Debt Service ·
 * DSCR business/global · engine version — always visible under the three
 * zones. Values arrive pre-computed as strings (Iron Law #3: the client
 * renders, never computes; formatting is string work in money-display).
 * Policy compliance chips join in M8.6.
 */

import { trpc } from "@/lib/trpc/client";
import { formatCents, formatRatio } from "@/lib/money-display";

export { formatRatio };

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col px-4 py-1.5 min-w-28">
      <span className="text-[10px] uppercase tracking-wide text-ink-muted dark:text-ink-dark-muted">
        {label}
      </span>
      <span
        className={`text-sm font-semibold tabular-nums ${accent ? "text-primary dark:text-primary-dark" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function PolicyChips({ dealId, scenarioId }: { dealId: string; scenarioId: string | null }) {
  const policy = trpc.policy.forDeal.useQuery({ dealId, scenarioId });
  const p = policy.data;
  if (!p) return null;
  if (!p.available) {
    return <span className="text-[10px] text-ink-muted dark:text-ink-dark-muted">{p.reason}</span>;
  }
  return (
    <div className="flex items-center gap-1" aria-label="policy compliance">
      {!p.certifiable && (
        <span className="rounded bg-computed px-1.5 py-0.5 text-[10px] font-semibold text-white">
          DRAFT PACK — advisory only
        </span>
      )}
      {p.rules.map((r) => (
        <span
          key={r.ruleId}
          title={`${r.label} (${r.metric})`}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ${
            r.status === "pass"
              ? "bg-dscr-good"
              : r.status === "fail"
                ? "bg-dscr-bad"
                : "bg-dscr-warn"
          }`}
        >
          {r.ruleId}
        </span>
      ))}
    </div>
  );
}

export function MetricsStrip({
  dealId,
  periodLabel,
  scenarioId = null,
}: {
  dealId: string;
  periodLabel?: string;
  scenarioId?: string | null;
}) {
  const utils = trpc.useUtils();
  const metrics = trpc.metrics.forDeal.useQuery({ dealId, scenarioId });
  const recompute = trpc.metrics.recompute.useMutation({
    onSuccess: () => void utils.invalidate(),
  });

  const rows = metrics.data ?? [];
  // The strip shows the most recent period present unless one is pinned.
  const period =
    periodLabel ??
    rows
      .map((m) => m.periodLabel)
      .filter((p): p is string => p !== null)
      .sort()
      .at(-1) ??
    null;

  const centsOf = (metric: string) => {
    const m = rows.find(
      (r) => r.metric === metric && (r.periodLabel === period || r.periodLabel === null),
    );
    return m?.valueCents != null ? formatCents(m.valueCents) : "—";
  };
  const ratioOf = (metric: string) => {
    const m = rows.find(
      (r) => r.metric === metric && (r.periodLabel === period || r.periodLabel === null),
    );
    return m?.ratioMantissa != null && m.ratioScale != null
      ? formatRatio(m.ratioMantissa, m.ratioScale)
      : "—";
  };

  const engineVersion = rows[0]?.engineVersion;

  return (
    <footer
      aria-label="metrics strip"
      className="flex items-center gap-2 border-t border-line dark:border-line-dark bg-surface-muted dark:bg-surface-dark-muted"
    >
      <Stat label={`CFADS ${period ?? ""}`} value={centsOf("cfads")} />
      <Stat label="Debt service" value={centsOf("annual_debt_service")} />
      <Stat label="DSCR (biz)" value={ratioOf("dscr_business")} accent />
      <Stat label="DSCR (global)" value={ratioOf("dscr_global")} accent />
      <Stat label="Global CF" value={centsOf("global_cash_flow")} />
      <PolicyChips dealId={dealId} scenarioId={scenarioId} />
      <div className="ml-auto flex items-center gap-2 pr-4">
        <button
          aria-label="Recompute"
          title="Re-run the engine over current facts"
          onClick={() => recompute.mutate({ dealId })}
          disabled={recompute.isPending}
          className="rounded border border-line px-1.5 py-0.5 text-[10px] dark:border-line-dark"
        >
          ↻ {recompute.isPending ? "…" : "recompute"}
        </button>
        <span className="text-[10px] text-ink-muted dark:text-ink-dark-muted">
          {engineVersion ?? "no engine run yet"}
        </span>
      </div>
    </footer>
  );
}
