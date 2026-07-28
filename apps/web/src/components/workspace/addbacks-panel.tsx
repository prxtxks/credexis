"use client";

/**
 * Add-backs panel (M7.3): the suggest/decide surface for the ONE addback
 * model (post-mortem trap 8 — V1 captured categories then hardcoded
 * "other"). "Scan" runs the engine's deterministic suggestion rules over
 * accepted facts; every suggestion carries its source fact and rationale,
 * and a human accepts or rejects — decisions recompute SDE/CFADS
 * server-side (M7.7). The client renders integer-cent strings only.
 */

import { Check, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { formatCents } from "@/lib/money-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const CATEGORY_LABEL: Record<string, string> = {
  depreciation: "Depreciation",
  amortization: "Amortization",
  depreciation_amortization: "D&A",
  interest: "Interest",
  officer_comp: "Officer comp",
  one_time: "One-time",
  discretionary: "Discretionary",
  rent_adj: "Rent adjustment",
  other: "Other",
};

function AddbackRow({
  addback,
  onDecide,
  deciding,
}: {
  addback: {
    id: string;
    category: string;
    state: string;
    amountCents: string;
    note: string | null;
    taxonomyNodeKey: string | null;
    periodLabel: string | null;
  };
  onDecide?: ((state: "accepted" | "rejected") => void) | undefined;
  deciding?: boolean | undefined;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-2.5">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="border-computed/40 text-computed">
          {CATEGORY_LABEL[addback.category] ?? addback.category}
        </Badge>
        <span className="font-mono text-sm font-semibold tabular-nums">
          {formatCents(addback.amountCents)}
        </span>
        {addback.periodLabel ? (
          <span className="ml-auto text-[11px] text-muted-foreground">{addback.periodLabel}</span>
        ) : null}
      </div>
      {addback.taxonomyNodeKey ? (
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {addback.taxonomyNodeKey}
        </p>
      ) : null}
      {addback.note ? <p className="mt-1 text-xs text-muted-foreground">{addback.note}</p> : null}
      {onDecide ? (
        <div className="mt-2 flex gap-2">
          <Button
            size="xs"
            variant="outline"
            disabled={deciding}
            onClick={() => onDecide("accepted")}
            className="gap-1 rounded-full"
          >
            <Check className="h-3 w-3" />
            accept
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={deciding}
            onClick={() => onDecide("rejected")}
            className="gap-1 rounded-full text-muted-foreground"
          >
            <X className="h-3 w-3" />
            reject
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function AddbacksPanel({ dealId }: { dealId: string }) {
  const utils = trpc.useUtils();
  const addbacks = trpc.addbacks.list.useQuery({ dealId });

  const refresh = () => {
    void utils.addbacks.list.invalidate({ dealId });
    void utils.metrics.invalidate();
    void utils.policy.invalidate();
  };
  const suggest = trpc.addbacks.suggest.useMutation({
    onSuccess: (r) => {
      refresh();
      toast.success(
        r.suggested > 0
          ? `${r.suggested} new add-back suggestion${r.suggested === 1 ? "" : "s"}`
          : "No new suggestions — all known patterns already recorded",
      );
    },
    onError: (e) => toast.error(e.message),
  });
  const decide = trpc.addbacks.decide.useMutation({
    onSuccess: (r) => {
      refresh();
      toast.success(
        r.state === "accepted" ? "Add-back accepted — metrics recomputed" : "Add-back rejected",
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = addbacks.data ?? [];
  const suggested = rows.filter((a) => a.state === "suggested");
  const accepted = rows.filter((a) => a.state === "accepted");
  const rejected = rows.filter((a) => a.state === "rejected");

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Add-backs
        </h2>
        <Button
          size="xs"
          variant="outline"
          disabled={suggest.isPending}
          onClick={() => suggest.mutate({ dealId })}
          className="gap-1.5 rounded-full"
        >
          <Sparkles className="h-3 w-3" />
          {suggest.isPending ? "Scanning…" : "Scan for suggestions"}
        </Button>
      </div>

      {addbacks.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No add-backs yet. Scan runs the engine&apos;s rules (depreciation, amortization, interest,
          officer comp…) over the deal&apos;s accepted facts; you can also add one manually from any
          cell&apos;s Source view.
        </p>
      ) : null}

      {suggested.length > 0 ? (
        <section>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-severity-warning">
            Suggested — needs a decision ({suggested.length})
          </h3>
          <div className="space-y-2">
            {suggested.map((a) => (
              <AddbackRow
                key={a.id}
                addback={a}
                deciding={decide.isPending}
                onDecide={(state) => decide.mutate({ addbackId: a.id, state })}
              />
            ))}
          </div>
        </section>
      ) : null}

      {accepted.length > 0 ? (
        <section>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            Accepted — in the cash flow ({accepted.length})
          </h3>
          <div className="space-y-2">
            {accepted.map((a) => (
              <AddbackRow key={a.id} addback={a} />
            ))}
          </div>
        </section>
      ) : null}

      {rejected.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            {rejected.length} rejected
          </summary>
          <div className="mt-2 space-y-2 opacity-60">
            {rejected.map((a) => (
              <AddbackRow key={a.id} addback={a} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
