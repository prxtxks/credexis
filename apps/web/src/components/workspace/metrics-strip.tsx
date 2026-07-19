"use client";

/**
 * Persistent metrics strip (M8.2, Blueprint §8.2): CFADS · Debt Service ·
 * DSCR business/global · engine version — always visible under the three
 * zones. Values arrive pre-computed as strings (Iron Law #3: the client
 * renders, never computes; formatting is string work in money-display).
 * Policy compliance chips join in M8.6.
 */

import { trpc } from "@/lib/trpc/client";
import { formatCents } from "@/lib/money-display";

/** Fixed-point mantissa at a scale → display string; pure string work. */
export function formatRatio(mantissa: string, scale: number): string {
  const neg = mantissa.startsWith("-");
  const digits = neg ? mantissa.slice(1) : mantissa;
  const padded = digits.padStart(scale + 1, "0");
  const head = padded.slice(0, padded.length - scale) || "0";
  const tail = scale > 0 ? `.${padded.slice(padded.length - scale)}` : "";
  return `${neg ? "-" : ""}${head}${tail}`;
}

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

export function MetricsStrip({ dealId, periodLabel }: { dealId: string; periodLabel?: string }) {
  const metrics = trpc.metrics.forDeal.useQuery({ dealId });

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
      <div className="ml-auto pr-4 text-[10px] text-ink-muted dark:text-ink-dark-muted">
        {engineVersion ?? "no engine run yet"}
      </div>
    </footer>
  );
}
