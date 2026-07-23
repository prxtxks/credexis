"use client";

/**
 * Issues panel (M8.5): open gate violations grouped by severity. Clicking
 * an issue opens its first implicated fact in the source viewer — resolve
 * by override there or through the review queue.
 */

import { trpc } from "@/lib/trpc/client";

const SEVERITY_ORDER = ["critical", "error", "warning", "info"] as const;

const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-severity-critical",
  error: "bg-severity-error",
  warning: "bg-severity-warning",
  info: "bg-severity-info",
};

export function IssuesPanel({
  dealId,
  onOpenFact,
}: {
  dealId: string;
  onOpenFact: (factId: string) => void;
}) {
  const issues = trpc.issues.forDeal.useQuery({ dealId }, { refetchInterval: 10_000 });

  if (issues.isLoading) return <p className="text-sm">Loading issues…</p>;
  if (issues.error) {
    return <p className="text-sm text-severity-critical">{issues.error.message}</p>;
  }
  const rows = issues.data ?? [];
  if (rows.length === 0) {
    return <p className="p-2 text-sm text-muted-foreground">No open gate violations 🎉</p>;
  }

  return (
    <div className="space-y-3">
      {SEVERITY_ORDER.map((sev) => {
        const group = rows.filter((i) => i.severity === sev);
        if (group.length === 0) return null;
        return (
          <section key={sev}>
            <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <span className={`h-2 w-2 rounded-full ${SEVERITY_CLASS[sev]}`} />
              {sev} ({group.length})
            </h3>
            <ul className="space-y-1">
              {group.map((i) => (
                <li key={i.id}>
                  <button
                    onClick={() => i.factIds[0] && onOpenFact(i.factIds[0])}
                    className="w-full rounded border border-border p-2 text-left text-xs leading-snug hover:bg-muted dark:hover:bg-muted"
                  >
                    <span className="font-mono font-semibold">{i.gate}</span> · {i.message}
                    <span className="mt-0.5 block text-muted-foreground">
                      {i.factIds.length} implicated {i.factIds.length === 1 ? "cell" : "cells"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
