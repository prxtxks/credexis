"use client";

/**
 * Underwriting workspace shell (M8.2, Blueprint §8.2): three-zone cockpit -
 * left rail (deal nav, collapsible) · center spread (tabs) · right
 * inspector - over a persistent metrics strip. Panel state lives in the
 * URL (?rail=0&panel=0&tab=bs) so layouts are shareable and survive
 * reload. V1 chrome (ui-3): frosted toolbar, segmented pill tabs, glass
 * panels over the gradient mesh.
 */

import { Suspense, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, FileStack, ListChecks, UserRound } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { FieldSelect } from "@/components/ui/field-select";

type DealStatus = "intake" | "parsing" | "review" | "complete";
import { MetricsStrip } from "@/components/workspace/metrics-strip";
import { SpreadGrid, type CellSelection } from "@/components/workspace/spread-grid";
import { TaxSpreadGrid } from "@/components/workspace/tax-spread-grid";
import { SourceViewer } from "@/components/workspace/source-viewer";
import { IssuesPanel } from "@/components/workspace/issues-panel";
import { AddbacksPanel } from "@/components/workspace/addbacks-panel";
import { ScenarioInspector } from "@/components/workspace/scenario-inspector";
import { WorkspaceToolbar, type InspectorTab } from "@/components/workspace/workspace-toolbar";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "is", label: "Income Statement" },
  { key: "bs", label: "Balance Sheet" },
  { key: "tax", label: "Tax Spread" },
  { key: "gcf", label: "Global Cash Flow" },
  { key: "proforma", label: "Pro-Forma" },
] as const;

const STATUS_CHIP: Record<string, string> = {
  uploaded: "bg-muted-foreground",
  processing: "bg-severity-warning",
  processed: "bg-primary",
  failed: "bg-severity-critical",
};

/** deal_status enum → display string (never print the raw enum). */
const STATUS_LABEL: Record<string, string> = {
  intake: "Intake",
  parsing: "Parsing",
  review: "In review",
  complete: "Complete",
};

function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("source");
  const scenarioId = search.get("scenario");

  const utils = trpc.useUtils();
  const deal = trpc.deals.get.useQuery({ dealId });
  const setStatus = trpc.deals.setStatus.useMutation({
    onSuccess: () => {
      void utils.deals.get.invalidate({ dealId });
      toast.success("Deal status updated");
    },
    onError: (e) => toast.error(e.message),
  });
  const entities = trpc.assignment.entities.useQuery({ dealId });
  const entityId = entityParam ?? entities.data?.[0]?.id ?? null;
  const docs = trpc.documents.list.useQuery({ dealId });
  const progress = trpc.review.progress.useQuery({ dealId });
  const issues = trpc.issues.forDeal.useQuery({ dealId });
  const transcripts = trpc.transcripts.forDeal.useQuery({ dealId });
  const setTranscripts = trpc.transcripts.setEnabled.useMutation({
    onSuccess: () => void utils.transcripts.forDeal.invalidate({ dealId }),
  });
  const requestConsent = trpc.transcripts.requestConsent.useMutation({
    onSuccess: () => void utils.transcripts.forDeal.invalidate({ dealId }),
  });

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="gradient-mesh flex h-screen flex-col">
      <WorkspaceToolbar
        dealName={deal.data?.name ?? "…"}
        dealType={deal.data?.type ?? ""}
        exportHref={`/api/deals/${dealId}/export${scenarioId ? `?scenario=${scenarioId}` : ""}`}
        railOpen={railOpen}
        panelOpen={panelOpen}
        inspectorTab={inspectorTab}
        issuesCount={issues.data?.length ?? 0}
        onToggleRail={() => setParam("rail", railOpen ? "0" : null)}
        onTogglePanel={() => setParam("panel", panelOpen ? "0" : null)}
        onInspectorTab={(t) => {
          setInspectorTab(t);
          if (!panelOpen) setParam("panel", null);
        }}
      />

      {/* ── Mobile deal summary (M11.8): the cockpit is desktop-grade -
          phones get status, progress, and the actionable surfaces
          (documents, review), never a 13-column grid. ── */}
      <div className="scroll-pane flex-1 space-y-4 overflow-y-auto p-4 md:hidden">
        <div className="glass-card rounded-lg p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Deal status
          </p>
          {/* The DB enum is not a display string, and a loading query must
              not read as a real zero - counts render only once both queries
              have landed (a wrong number in an underwriting tool is a bug,
              not a placeholder). */}
          <p className="mt-1 text-lg font-bold">
            {deal.data ? (STATUS_LABEL[deal.data.status] ?? deal.data.status) : "…"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {docs.data && issues.data ? (
              <>
                {docs.data.length} {docs.data.length === 1 ? "document" : "documents"} ·{" "}
                {docs.data.filter((d) => d.status === "processed").length} processed ·{" "}
                {issues.data.length} open {issues.data.length === 1 ? "issue" : "issues"}
              </>
            ) : (
              "Loading…"
            )}
          </p>
        </div>
        {progress.data ? (
          <div className="glass-card rounded-lg p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Review queue
            </p>
            <p className="mt-1 text-sm">{progress.data.remaining} awaiting a decision</p>
            <Link
              href={`/deals/${dealId}/review`}
              className="mt-2 inline-block text-sm font-medium text-primary underline underline-offset-2"
            >
              Open review queue
            </Link>
          </div>
        ) : null}
        <div className="glass-card rounded-lg p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Documents
          </p>
          <Link
            href={`/deals/${dealId}/documents`}
            className="mt-2 inline-block text-sm font-medium text-primary underline underline-offset-2"
          >
            Upload & track documents
          </Link>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          The full underwriting workspace - spread grid, source viewer, and exports - is designed
          for desktop. Open Credexis on a larger screen for the complete cockpit.
        </p>
      </div>

      {/* ── Three zones ─────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 max-md:hidden">
        {railOpen && (
          <nav
            aria-label="deal navigation"
            className="scroll-pane w-[280px] shrink-0 border-r border-border bg-card/40 py-3 backdrop-blur-sm max-md:hidden"
          >
            <RailSection title="Deal status">
              {/* The ONLY place a human can move a deal forward. Without it
                  a deal reaches Review and sticks there permanently: the
                  pipeline advances intake→parsing→review, but review→complete
                  is a judgement nobody but an underwriter can make. */}
              <div className="px-3 py-1">
                <FieldSelect
                  ariaLabel="Deal status"
                  value={deal.data?.status ?? "intake"}
                  onChange={(v) => setStatus.mutate({ dealId, status: v as DealStatus })}
                  disabled={!deal.data || setStatus.isPending}
                  options={[
                    { value: "intake", label: "Intake" },
                    { value: "parsing", label: "Parsing" },
                    { value: "review", label: "Review" },
                    { value: "complete", label: "Complete" },
                  ]}
                  className="w-full"
                />
              </div>
            </RailSection>

            <RailSection title="Entities">
              {(entities.data ?? []).map((e) => (
                <button
                  key={e.id}
                  onClick={() => setParam("entity", e.id === entities.data?.[0]?.id ? null : e.id)}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent/50",
                    e.id === entityId && "bg-accent font-semibold",
                  )}
                >
                  {e.name}
                  <span className="ml-2 text-xs text-muted-foreground">{e.kind}</span>
                </button>
              ))}
              {(entities.data ?? []).length === 0 && (
                <p className="px-3 text-xs text-muted-foreground">No entities yet.</p>
              )}
            </RailSection>

            <RailSection title="Documents">
              {(docs.data ?? []).slice(0, 8).map((d) => (
                <div key={d.id} className="flex items-center gap-2 px-3 py-1 text-sm">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${STATUS_CHIP[d.status] ?? "bg-muted-foreground"}`}
                    title={d.status}
                  />
                  <span className="truncate">{d.fileName}</span>
                </div>
              ))}
              <Link
                href={`/deals/${dealId}/documents`}
                className="flex items-center gap-1 px-3 py-1 text-xs text-primary hover:underline"
              >
                <FileStack className="h-3 w-3" />
                All documents
                <ArrowRight className="h-3 w-3" />
              </Link>
            </RailSection>

            <RailSection title="IRS transcripts">
              {transcripts.data?.enabled ? (
                <>
                  {(entities.data ?? []).map((e) => {
                    const consent = transcripts.data?.consents.find((c) => c.entityId === e.id);
                    return (
                      <div key={e.id} className="flex items-center gap-2 px-3 py-1 text-xs">
                        <span className="truncate">{e.name}</span>
                        {consent ? (
                          <span className="ml-auto text-muted-foreground">{consent.status}</span>
                        ) : (
                          <button
                            className="ml-auto text-primary underline underline-offset-2"
                            onClick={() => requestConsent.mutate({ dealId, entityId: e.id })}
                          >
                            request 8821
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {requestConsent.data && !requestConsent.data.requested && (
                    <p className="px-3 py-1 text-[11px] text-severity-warning">
                      {requestConsent.data.reason}
                    </p>
                  )}
                  <button
                    className="px-3 py-1 text-[11px] text-muted-foreground underline underline-offset-2"
                    onClick={() => setTranscripts.mutate({ dealId, enabled: false })}
                  >
                    disable for this deal
                  </button>
                </>
              ) : (
                <button
                  className="px-3 py-1 text-xs text-primary underline underline-offset-2"
                  onClick={() => setTranscripts.mutate({ dealId, enabled: true })}
                >
                  Enable IRS transcript verification
                </button>
              )}
            </RailSection>

            <RailSection title="Review">
              <Link
                href={`/deals/${dealId}/review`}
                className="flex items-center gap-1.5 px-3 py-1 text-sm text-primary hover:underline"
              >
                <ListChecks className="h-3.5 w-3.5" />
                Review queue{progress.data ? ` (${progress.data.total - progress.data.done})` : ""}
              </Link>
              <Link
                href={`/deals/${dealId}/assignment`}
                className="flex items-center gap-1.5 px-3 py-1 text-sm text-primary hover:underline"
              >
                <FileStack className="h-3.5 w-3.5" />
                Document assignment
              </Link>
              <Link
                href={`/deals/${dealId}/borrower`}
                className="flex items-center gap-1.5 px-3 py-1 text-sm text-primary hover:underline"
              >
                <UserRound className="h-3.5 w-3.5" />
                Borrower portal
              </Link>
            </RailSection>
          </nav>
        )}

        {/* Center - spread tabs */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div role="tablist" className="flex items-center gap-1 px-3 py-2">
            <div className="flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setParam("tab", t.key === "is" ? null : t.key)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    tab === t.key
                      ? "bg-card text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="scroll-pane flex-1 px-3 pb-3">
            {(tab === "is" || tab === "bs" || tab === "gcf") && entityId ? (
              <SpreadGrid
                dealId={dealId}
                entityId={entityId}
                statement={tab}
                onSelectCell={(sel) => {
                  setSelection(sel);
                  setInspectorTab("source");
                }}
              />
            ) : tab === "tax" && entityId ? (
              <TaxSpreadGrid
                dealId={dealId}
                entityId={entityId}
                onSelectCell={(sel) => {
                  setSelection(sel);
                  setInspectorTab("source");
                }}
              />
            ) : tab === "proforma" ? (
              <div className="glass-card flex h-full items-center justify-center rounded-xl text-sm text-muted-foreground">
                Pro-forma - the post-acquisition projection view. Pick a loan scenario to populate
                it.
              </div>
            ) : (
              <div className="glass-card flex h-full items-center justify-center rounded-xl text-sm text-muted-foreground">
                Add an entity to this deal to open its spread.
              </div>
            )}
          </div>
        </main>

        {/* Right - inspector */}
        {panelOpen && (
          <aside
            aria-label="inspector"
            className="side-panel-enter scroll-pane w-[360px] shrink-0 border-l border-border bg-card/40 p-4 backdrop-blur-sm max-lg:hidden"
          >
            {inspectorTab === "scenario" ? (
              <ScenarioInspector
                dealId={dealId}
                selectedScenarioId={scenarioId}
                onSelectScenario={(id) => setParam("scenario", id)}
              />
            ) : inspectorTab === "addbacks" ? (
              <AddbacksPanel dealId={dealId} />
            ) : inspectorTab === "issues" ? (
              <IssuesPanel
                dealId={dealId}
                onOpenFact={(factId) => {
                  setSelection({ factId, nodeKey: "", periodLabel: "" });
                  setInspectorTab("source");
                }}
              />
            ) : selection ? (
              <SourceViewer
                dealId={dealId}
                selection={selection}
                onMutated={() => {
                  setSelection(null);
                  void utils.invalidate(); // fresh engine output everywhere
                }}
              />
            ) : (
              <div className="glass-card flex h-full items-center justify-center rounded-xl p-4 text-center text-sm text-muted-foreground">
                Select a cell to trace its source.
              </div>
            )}
          </aside>
        )}
      </div>

      <div className="max-md:hidden">
        <MetricsStrip dealId={dealId} scenarioId={scenarioId} />
      </div>
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
