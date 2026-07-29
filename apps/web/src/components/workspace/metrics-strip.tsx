"use client";

/**
 * Persistent metrics strip (M8.2, Blueprint §8.2): CFADS · Debt Service ·
 * DSCR business/global · engine version — always visible under the three
 * zones. Values arrive pre-computed as strings (Iron Law #3: the client
 * renders, never computes; formatting is string work in money-display).
 * Policy compliance chips join in M8.6.
 */

import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { formatCents, formatRatio } from "@/lib/money-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export { formatRatio };

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex min-w-28 flex-col border-r border-border/40 px-4 py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">{label}</span>
      {/* Money/ratios are the protagonist (design language §2): Geist
          tabular figures, semibold — never mono-terminal, never muted. */}
      <span className={`text-[15px] font-semibold tabular-nums ${accent ? "text-primary" : ""}`}>
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
    return <span className="text-[10px] text-muted-foreground">{p.reason}</span>;
  }
  return (
    <div className="flex items-center gap-1" aria-label="policy compliance">
      {!p.certifiable && (
        <Badge className="rounded-full border-0 bg-computed px-2 text-[10px] font-semibold text-white">
          DRAFT PACK — advisory only
        </Badge>
      )}
      {p.rules.map((r) => (
        <Badge
          key={r.ruleId}
          title={`${r.label} (${r.metric})`}
          className={`rounded-full border-0 px-2 text-[10px] font-semibold text-white ${
            r.status === "pass"
              ? "bg-dscr-good"
              : r.status === "fail"
                ? "bg-dscr-bad"
                : "bg-dscr-warn"
          }`}
        >
          {r.ruleId}
        </Badge>
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
    onSuccess: () => {
      void utils.invalidate();
      toast.success("Metrics recomputed");
    },
    onError: (e) => toast.error(e.message),
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
      className="frosted-toolbar flex items-center gap-2 !border-b-0 border-t"
    >
      <Stat label={`CFADS ${period ?? ""}`} value={centsOf("cfads")} />
      <Stat label="Debt service" value={centsOf("annual_debt_service")} />
      <Stat label="DSCR (biz)" value={ratioOf("dscr_business")} accent />
      <Stat label="DSCR (global)" value={ratioOf("dscr_global")} accent />
      <Stat label="Global CF" value={centsOf("global_cash_flow")} />
      <PolicyChips dealId={dealId} scenarioId={scenarioId} />
      <div className="ml-auto flex items-center gap-2 pr-4">
        <Button
          aria-label="Recompute"
          title="Re-run the engine over current facts"
          onClick={() => recompute.mutate({ dealId })}
          disabled={recompute.isPending}
          variant="outline"
          size="xs"
          className="h-6 rounded-full text-[10px]"
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${recompute.isPending ? "animate-spin" : ""}`} />
          {recompute.isPending ? "…" : "recompute"}
        </Button>
        <span className="text-[10px] text-muted-foreground">
          {engineVersion ?? "no engine run yet"}
        </span>
      </div>
    </footer>
  );
}
