"use client";

/**
 * Underwriting workspace shell (M8.2, Blueprint §8.2): three-zone cockpit -
 * left rail (deal nav, collapsible) · center spread (tabs) · right
 * inspector - over a persistent metrics strip. Panel state lives in the
 * URL (?rail=0&panel=0&tab=bs) so layouts are shareable and survive
 * reload. V1 chrome (ui-3): frosted toolbar, segmented pill tabs, glass
 * panels over the gradient mesh.
 */

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { NAV_DEAL } from "@/components/nav-config";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Switch } from "@/components/ui/switch";

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

/** Section shell matching the app sidebar's vocabulary (ui-26: the
 *  workspace rail read as a different product from the rest of the app). */
function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h2>
      <div className="mt-1.5 space-y-0.5">{children}</div>
    </section>
  );
}

/** Inspector width + grid zoom are per-browser layout preferences. */
const INSPECTOR_WIDTH_KEY = "credexis-inspector-width";
const GRID_ZOOM_KEY = "credexis-grid-zoom";
const INSPECTOR_MIN = 320;
const INSPECTOR_MAX = 720;

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

  // ui-26: draggable inspector width + center-grid zoom, both persisted.
  const [inspectorWidth, setInspectorWidth] = useState(360);
  const [gridZoom, setGridZoom] = useState(1);
  useEffect(() => {
    const w = Number(localStorage.getItem(INSPECTOR_WIDTH_KEY));
    if (w >= INSPECTOR_MIN && w <= INSPECTOR_MAX) setInspectorWidth(w);
    const z = Number(localStorage.getItem(GRID_ZOOM_KEY));
    if (z >= 0.7 && z <= 1.4) setGridZoom(z);
  }, []);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  function onResizeStart(e: React.PointerEvent) {
    dragState.current = { startX: e.clientX, startWidth: inspectorWidth };
    const onMove = (ev: PointerEvent) => {
      const s = dragState.current;
      if (!s) return;
      const w = Math.min(
        INSPECTOR_MAX,
        Math.max(INSPECTOR_MIN, s.startWidth + (s.startX - ev.clientX)),
      );
      setInspectorWidth(w);
    };
    const onUp = () => {
      dragState.current = null;
      setInspectorWidth((w) => {
        localStorage.setItem(INSPECTOR_WIDTH_KEY, String(w));
        return w;
      });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  function bumpZoom(delta: number) {
    setGridZoom((z) => {
      const next = Math.min(1.4, Math.max(0.7, Math.round((z + delta) * 10) / 10));
      localStorage.setItem(GRID_ZOOM_KEY, String(next));
      return next;
    });
  }

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
            className="scroll-pane border-sidebar-border bg-sidebar w-60 shrink-0 border-r px-3 py-3 max-md:hidden"
          >
            {/* Same anatomy as the app sidebar's deal takeover (ui-26). */}
            <Link
              href="/"
              title="All deals"
              className="text-foreground hover:bg-sidebar-accent/60 mb-2 flex h-9 items-center gap-1 rounded-lg px-1.5 text-sm font-semibold transition-colors duration-150"
            >
              <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-center">{deal.data?.name ?? "…"}</span>
              <span aria-hidden="true" className="size-4" />
            </Link>
            <div className="mb-4 space-y-0.5">
              {NAV_DEAL.map((item) => {
                const href = `/deals/${dealId}/${item.segment}`;
                const active = item.segment === "workspace";
                const suffix =
                  item.segment === "review" && progress.data
                    ? progress.data.total - progress.data.done
                    : null;
                return (
                  <Link
                    key={item.segment}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center rounded-lg px-2.5 text-sm font-medium transition-colors duration-150",
                      active
                        ? "bg-sidebar-accent text-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                    )}
                  >
                    <span className="flex-1">{item.label}</span>
                    {suffix !== null && suffix > 0 ? (
                      <span className="text-muted-foreground text-[12px] tabular-nums">
                        {suffix}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
            <div className="border-sidebar-border mb-4 border-t" />

            <RailSection title="Deal status">
              {/* The ONLY place a human can move a deal forward. Without it
                  a deal reaches Review and sticks there permanently: the
                  pipeline advances intake→parsing→review, but review→complete
                  is a judgement nobody but an underwriter can make. */}
              <div className="px-0.5 py-1">
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
                    "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium transition-colors duration-150",
                    e.id === entityId
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <span className="text-muted-foreground text-[11px]">{e.kind}</span>
                </button>
              ))}
              {(entities.data ?? []).length === 0 && (
                <p className="text-muted-foreground px-2.5 text-xs">No entities yet.</p>
              )}
            </RailSection>

            <RailSection title="Documents">
              {(docs.data ?? []).slice(0, 8).map((d) => (
                <div
                  key={d.id}
                  className="text-muted-foreground flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px]"
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${STATUS_CHIP[d.status] ?? "bg-muted-foreground"}`}
                    title={d.status}
                  />
                  <span className="truncate">{d.fileName}</span>
                </div>
              ))}
            </RailSection>

            <RailSection title="IRS verification">
              <div className="flex h-9 items-center gap-2 rounded-lg px-2.5">
                <span className="text-muted-foreground flex-1 text-[13px] font-medium">
                  Transcript check
                </span>
                <Switch
                  aria-label="IRS transcript verification"
                  checked={transcripts.data?.enabled ?? false}
                  disabled={!transcripts.data || setTranscripts.isPending}
                  onCheckedChange={(on) => setTranscripts.mutate({ dealId, enabled: on })}
                />
              </div>
              {transcripts.data?.enabled ? (
                <>
                  {(entities.data ?? []).map((e) => {
                    const consent = transcripts.data?.consents.find((c) => c.entityId === e.id);
                    return (
                      <div
                        key={e.id}
                        className="text-muted-foreground flex h-8 items-center gap-2 px-2.5 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate">{e.name}</span>
                        {consent ? (
                          <span>{consent.status}</span>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => requestConsent.mutate({ dealId, entityId: e.id })}
                            disabled={requestConsent.isPending}
                          >
                            Request 8821
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {requestConsent.data && !requestConsent.data.requested && (
                    <p className="text-severity-warning px-2.5 py-1 text-[11px]">
                      {requestConsent.data.reason}
                    </p>
                  )}
                </>
              ) : null}
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
            {/* Grid zoom (ui-26): CSS zoom reflows the grid, so hit-testing
                and column widths stay correct at every step. */}
            <div className="ml-auto flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5">
              <button
                type="button"
                aria-label="Zoom grid out"
                onClick={() => bumpZoom(-0.1)}
                className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded-full transition-colors"
              >
                <Minus className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Reset grid zoom"
                onClick={() => {
                  setGridZoom(1);
                  localStorage.setItem(GRID_ZOOM_KEY, "1");
                }}
                className="text-muted-foreground hover:text-foreground w-11 text-center text-[11px] font-medium tabular-nums transition-colors"
              >
                {Math.round(gridZoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="Zoom grid in"
                onClick={() => bumpZoom(0.1)}
                className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded-full transition-colors"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          </div>
          <div className="scroll-pane flex-1 px-3 pb-3" style={{ zoom: gridZoom }}>
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

        {/* Right - inspector (ui-26: resizable; the PDF earns the width) */}
        {panelOpen && (
          /* A generous 10px hitbox around a hairline grip - the 4px first
             cut was a pixel-hunt to grab (ui-27). */
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector"
            onPointerDown={onResizeStart}
            className="group relative z-10 -mx-[5px] flex w-2.5 shrink-0 cursor-col-resize items-stretch justify-center max-lg:hidden"
          >
            <div className="group-hover:bg-primary/60 w-[3px] rounded-full bg-transparent transition-colors" />
          </div>
        )}
        {panelOpen && (
          <aside
            aria-label="inspector"
            style={{ width: inspectorWidth }}
            className="side-panel-enter scroll-pane shrink-0 border-l border-border bg-card/40 p-4 backdrop-blur-sm max-lg:hidden"
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
