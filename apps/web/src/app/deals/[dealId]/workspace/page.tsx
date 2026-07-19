"use client";

/**
 * Underwriting workspace shell (M8.2, Blueprint §8.2): three-zone cockpit —
 * left rail (deal nav, collapsible) · center spread (tabs) · right
 * inspector — over a persistent metrics strip. Panel state lives in the
 * URL (?rail=0&panel=0&tab=bs) so layouts are shareable and survive
 * reload. Content: the spread grid lands in M8.3, the source viewer in
 * M8.4, issues in M8.5, scenarios in M8.6 — the shell mounts their slots.
 */

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { MetricsStrip } from "@/components/workspace/metrics-strip";
import { SpreadGrid } from "@/components/workspace/spread-grid";
import { ThemeToggle } from "@/components/theme-toggle";

const TABS = [
  { key: "is", label: "Income Statement" },
  { key: "bs", label: "Balance Sheet" },
  { key: "tax", label: "Tax Spread" },
  { key: "gcf", label: "Global Cash Flow" },
  { key: "proforma", label: "Pro-Forma" },
] as const;

const STATUS_CHIP: Record<string, string> = {
  uploaded: "bg-ink-muted",
  processing: "bg-severity-warning",
  processed: "bg-primary",
  failed: "bg-severity-critical",
};

function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="px-3 text-[10px] font-semibold uppercase tracking-wider text-ink-muted dark:text-ink-dark-muted">
        {title}
      </h2>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function WorkspaceInner() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();

  const railOpen = search.get("rail") !== "0";
  const panelOpen = search.get("panel") !== "0";
  const tab = search.get("tab") ?? "is";
  const entityParam = search.get("entity");

  const deal = trpc.deals.get.useQuery({ dealId });
  const entities = trpc.assignment.entities.useQuery({ dealId });
  const entityId = entityParam ?? entities.data?.[0]?.id ?? null;
  const docs = trpc.documents.list.useQuery({ dealId });
  const progress = trpc.review.progress.useQuery({ dealId });

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex h-screen flex-col">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 border-b border-line px-4 py-2 dark:border-line-dark">
        <button
          aria-label={railOpen ? "Collapse rail" : "Expand rail"}
          onClick={() => setParam("rail", railOpen ? "0" : null)}
          className="rounded-md border border-line px-2 py-1 text-sm dark:border-line-dark"
        >
          ☰
        </button>
        <h1 className="text-sm font-semibold">{deal.data?.name ?? "…"}</h1>
        <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-ink-muted dark:bg-surface-dark-muted dark:text-ink-dark-muted">
          {deal.data?.type.replaceAll("_", " ") ?? ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            aria-label={panelOpen ? "Collapse inspector" : "Expand inspector"}
            onClick={() => setParam("panel", panelOpen ? "0" : null)}
            className="rounded-md border border-line px-2 py-1 text-sm dark:border-line-dark"
          >
            ⧉
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* ── Three zones ─────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {railOpen && (
          <nav
            aria-label="deal navigation"
            className="scroll-pane w-[280px] shrink-0 border-r border-line py-3 max-md:hidden dark:border-line-dark"
          >
            <RailSection title="Entities">
              {(entities.data ?? []).map((e) => (
                <button
                  key={e.id}
                  onClick={() => setParam("entity", e.id === entities.data?.[0]?.id ? null : e.id)}
                  className={`block w-full px-3 py-1 text-left text-sm ${
                    e.id === entityId
                      ? "bg-surface-muted font-semibold dark:bg-surface-dark-muted"
                      : ""
                  }`}
                >
                  {e.name}
                  <span className="ml-2 text-xs text-ink-muted dark:text-ink-dark-muted">
                    {e.kind}
                  </span>
                </button>
              ))}
              {(entities.data ?? []).length === 0 && (
                <p className="px-3 text-xs text-ink-muted dark:text-ink-dark-muted">
                  No entities yet.
                </p>
              )}
            </RailSection>

            <RailSection title="Documents">
              {(docs.data ?? []).slice(0, 8).map((d) => (
                <div key={d.id} className="flex items-center gap-2 px-3 py-1 text-sm">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${STATUS_CHIP[d.status] ?? "bg-ink-muted"}`}
                    title={d.status}
                  />
                  <span className="truncate">{d.fileName}</span>
                </div>
              ))}
              <Link
                href={`/deals/${dealId}/documents`}
                className="block px-3 py-1 text-xs text-primary dark:text-primary-dark"
              >
                All documents →
              </Link>
            </RailSection>

            <RailSection title="Review">
              <Link
                href={`/deals/${dealId}/review`}
                className="block px-3 py-1 text-sm text-primary dark:text-primary-dark"
              >
                Review queue{progress.data ? ` (${progress.data.total - progress.data.done})` : ""}
              </Link>
              <Link
                href={`/deals/${dealId}/assignment`}
                className="block px-3 py-1 text-sm text-primary dark:text-primary-dark"
              >
                Document assignment
              </Link>
            </RailSection>
          </nav>
        )}

        {/* Center — spread tabs */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div
            role="tablist"
            className="flex gap-1 border-b border-line px-2 dark:border-line-dark"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setParam("tab", t.key === "is" ? null : t.key)}
                className={`px-3 py-2 text-sm ${
                  tab === t.key
                    ? "border-b-2 border-primary font-semibold text-primary dark:border-primary-dark dark:text-primary-dark"
                    : "text-ink-muted dark:text-ink-dark-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="scroll-pane flex-1 p-2">
            {(tab === "is" || tab === "bs" || tab === "gcf") && entityId ? (
              <SpreadGrid dealId={dealId} entityId={entityId} statement={tab} />
            ) : tab === "tax" ? (
              <div className="glass-card flex h-full items-center justify-center text-sm text-ink-muted dark:text-ink-dark-muted">
                Tax spread — registry-line rows render here once extraction runs land facts.
              </div>
            ) : tab === "proforma" ? (
              <div className="glass-card flex h-full items-center justify-center text-sm text-ink-muted dark:text-ink-dark-muted">
                Pro-forma — post-acquisition projection view (scenario-driven, M8.6+).
              </div>
            ) : (
              <div className="glass-card flex h-full items-center justify-center text-sm text-ink-muted dark:text-ink-dark-muted">
                Add an entity to this deal to open its spread.
              </div>
            )}
          </div>
        </main>

        {/* Right — inspector */}
        {panelOpen && (
          <aside
            aria-label="inspector"
            className="scroll-pane w-[360px] shrink-0 border-l border-line p-4 max-lg:hidden dark:border-line-dark"
          >
            <div className="glass-card flex h-full items-center justify-center p-4 text-center text-sm text-ink-muted dark:text-ink-dark-muted">
              Select a cell for its source (M8.4) · issues (M8.5) · loan scenario inputs (M8.6).
            </div>
          </aside>
        )}
      </div>

      <MetricsStrip dealId={dealId} />
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense>
      <WorkspaceInner />
    </Suspense>
  );
}
