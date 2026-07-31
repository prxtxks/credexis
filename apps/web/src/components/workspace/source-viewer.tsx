"use client";

/**
 * Source viewer (M8.4 - the hero feature, Blueprint §8.2): the selected
 * cell's PDF page rendered with its bounding box highlighted, full lineage,
 * override + revert, and the explicit addback action with a category
 * picker. Rendering is pdf.js on a canvas; the bbox overlay is a
 * positioned div over normalized 0..1 coordinates.
 *
 * ui-26 (Pratik's workspace queue): the panel is a designed surface now -
 * value hero, sectioned cards, pill metadata - and the PDF is a real
 * viewport: zoom in/out/reset, drag to pan, re-rendered at each zoom step
 * (and at devicePixelRatio) so text stays crisp instead of scaling up a
 * 320px bitmap.
 */

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { formatCents, parseDollarsInput } from "@/lib/money-display";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import type { CellSelection } from "./spread-grid";

const ADDBACK_CATEGORIES = [
  "officer_comp",
  "depreciation_amortization",
  "interest",
  "one_time",
  "rent_adjustment",
  "discretionary",
] as const;

function PdfViewport({
  url,
  page,
  bbox,
}: {
  url: string;
  page: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  // The page re-fits LIVE as the inspector is resized (ui-27: dragging the
  // panel wider left the PDF at its old width until a zoom nudged it).
  // Debounced so pdf.js re-renders once per gesture, not per frame.
  const [fitWidth, setFitWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setFitWidth(el.clientWidth);
    let t: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => setFitWidth(el.clientWidth), 120);
    });
    ro.observe(el);
    return () => {
      if (t) clearTimeout(t);
      ro.disconnect();
    };
  }, []);

  // One download per URL (ui-27): zoom and resize re-render from the
  // cached document. Re-fetching on every zoom step both wasted bytes and
  // broke after the signed URL expired mid-session (400 on zoom).
  const docCache = useRef<{ url: string; promise: Promise<unknown> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        if (docCache.current?.url !== url) {
          docCache.current = { url, promise: pdfjs.getDocument({ url }).promise };
        }
        const doc = (await docCache.current.promise) as Awaited<
          ReturnType<typeof pdfjs.getDocument>["promise"]
        >;
        const pdfPage = await doc.getPage(Math.min(page, doc.numPages));
        const base = pdfPage.getViewport({ scale: 1 });
        const width = fitWidth || containerRef.current?.clientWidth || 320;
        const cssScale = (width / base.width) * zoom;
        // Render at devicePixelRatio so zoomed text is crisp, not upscaled.
        const dpr = window.devicePixelRatio || 1;
        const rendered = pdfPage.getViewport({ scale: cssScale * dpr });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = rendered.width;
        canvas.height = rendered.height;
        canvas.style.width = `${rendered.width / dpr}px`;
        canvas.style.height = `${rendered.height / dpr}px`;
        setSize({ w: rendered.width / dpr, h: rendered.height / dpr });
        await pdfPage.render({
          canvas,
          canvasContext: canvas.getContext("2d")!,
          viewport: rendered,
        }).promise;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, page, zoom, fitWidth]);

  if (error) {
    return <p className="text-severity-critical text-xs">PDF render failed: {error}</p>;
  }
  return (
    <div className="relative">
      <div
        ref={containerRef}
        onPointerDown={(e) => {
          const el = containerRef.current;
          if (!el) return;
          pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
          el.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const el = containerRef.current;
          const s = pan.current;
          if (!el || !s) return;
          el.scrollLeft = s.left - (e.clientX - s.x);
          el.scrollTop = s.top - (e.clientY - s.y);
        }}
        onPointerUp={() => (pan.current = null)}
        className={cn(
          "border-border bg-popover/40 max-h-[46vh] overflow-auto rounded-lg border select-none",
          zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        )}
      >
        <div className="relative inline-block">
          <canvas ref={canvasRef} />
          {bbox && size && (
            /* Marker anatomy (ui-27): a rounded OUTLINE with a soft outer
               halo and breathing room - the value stays fully readable,
               where the old translucent fill painted over the digits. */
            <div
              aria-label="source bounding box"
              className="border-primary pointer-events-none absolute rounded-[4px] border-2 shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_25%,transparent),0_0_18px_2px_color-mix(in_oklch,var(--primary)_35%,transparent)]"
              style={{
                left: bbox.x * size.w - 3,
                top: bbox.y * size.h - 3,
                width: bbox.w * size.w + 6,
                height: bbox.h * size.h + 6,
              }}
            />
          )}
        </div>
      </div>
      {/* Zoom cluster floats over the viewport corner. */}
      <div className="border-border bg-popover/90 absolute right-2 bottom-2 flex items-center gap-0.5 rounded-full border p-0.5 shadow-sm backdrop-blur">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.5) * 2) / 2))}
          className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded-full transition-colors"
        >
          <Minus className="size-3.5" />
        </button>
        <span className="text-muted-foreground w-9 text-center text-[11px] font-medium tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.5) * 2) / 2))}
          className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded-full transition-colors"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Fit page"
          onClick={() => setZoom(1)}
          className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded-full transition-colors"
        >
          <RotateCcw className="size-3" />
        </button>
      </div>
    </div>
  );
}

/** Definition row inside the lineage card. */
function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted-foreground text-[12px]">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[13px] font-medium">{children}</dd>
    </div>
  );
}

export function SourceViewer({
  dealId,
  selection,
  onMutated,
}: {
  dealId: string;
  selection: CellSelection;
  onMutated: () => void;
}) {
  const detail = trpc.source.factDetail.useQuery({ factId: selection.factId });
  const override = trpc.source.override.useMutation({ onSuccess: onMutated });
  const revert = trpc.source.revert.useMutation({ onSuccess: onMutated });
  const createAddback = trpc.addbacks.create.useMutation({ onSuccess: onMutated });

  const [draft, setDraft] = useState("");
  const [addbackCategory, setAddbackCategory] = useState<string>("one_time");

  if (detail.isLoading) return <p className="text-sm">Loading source…</p>;
  if (detail.error || !detail.data) {
    return <p className="text-severity-critical text-sm">{detail.error?.message}</p>;
  }
  const d = detail.data;

  function submitOverride() {
    const cents = parseDollarsInput(draft);
    if (cents === null) return;
    override.mutate({ factId: d.factId, correctedCents: cents });
    setDraft("");
  }

  return (
    <div className="space-y-4 text-sm">
      {/* ── Value hero ── */}
      <header>
        <code className="border-border bg-popover text-muted-foreground inline-block rounded-md border px-1.5 py-0.5 text-[11px]">
          {d.registryFieldId ?? d.taxonomyNodeKey}
        </code>
        <div className="mt-2 text-[26px] leading-8 font-semibold tabular-nums">
          {formatCents(d.valueCents)}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Pill tone={d.status === "suggested" ? "warn" : "neutral"}>{d.status}</Pill>
          <Pill>{d.method}</Pill>
        </div>
        {d.method === "override" && d.originalValueCents !== null && (
          <div className="text-muted-foreground mt-1.5 text-xs">
            was {formatCents(d.originalValueCents)}{" "}
            <button
              className="text-primary underline underline-offset-2"
              onClick={() => revert.mutate({ overrideFactId: d.factId })}
              disabled={revert.isPending}
            >
              revert
            </button>
          </div>
        )}
      </header>

      {/* ── Source render ── */}
      {d.document?.signedUrl ? (
        <PdfViewport url={d.document.signedUrl} page={d.document.pdfPage} bbox={d.bbox} />
      ) : (
        <div className="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-xs">
          No source render - {d.method === "human" ? "human-entered value" : "no PDF lineage"}.
        </div>
      )}

      {/* ── Lineage ── */}
      <dl className="glass-card divide-border/60 divide-y rounded-lg px-3.5 py-1.5">
        <MetaRow label="Document">{d.document?.fileName ?? "-"}</MetaRow>
        <MetaRow label="Form">
          {d.document?.formFamily ?? "-"} {d.document?.taxYear ?? ""}
        </MetaRow>
        <MetaRow label="Page">{d.document?.pdfPage ?? "-"}</MetaRow>
        <MetaRow label="Confidence">
          {d.confidence !== null ? `${Math.round(d.confidence * 100)}%` : "-"}
        </MetaRow>
      </dl>

      {/* ── Actions ── two identical rows: flexible control, fixed 88px
          button, everything h-8 on the same baseline (ui-27: the input,
          select, and buttons were four different widths). */}
      <div className="glass-card rounded-lg p-3.5">
        <label htmlFor="override" className="text-[12px] font-semibold">
          Override value
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <Input
            id="override"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="36,500.00"
            className="h-8 min-w-0 flex-1"
            onKeyDown={(e) => e.key === "Enter" && submitOverride()}
          />
          <Button
            size="sm"
            variant="brand"
            className="h-8 w-[88px] shrink-0"
            onClick={submitOverride}
            disabled={override.isPending}
          >
            Save
          </Button>
        </div>
        {override.error && (
          <p className="text-severity-critical mt-1.5 text-xs">{override.error.message}</p>
        )}

        <label htmlFor="addback-category" className="mt-4 block text-[12px] font-semibold">
          Add back this line
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <FieldSelect
            ariaLabel="Add-back category"
            value={addbackCategory}
            onChange={setAddbackCategory}
            options={ADDBACK_CATEGORIES.map((c) => ({
              value: c,
              label: c.replaceAll("_", " "),
            }))}
            className="h-8 min-w-0 flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-[88px] shrink-0"
            onClick={() =>
              createAddback.mutate({
                dealId,
                factId: d.factId,
                category: addbackCategory as (typeof ADDBACK_CATEGORIES)[number],
                amountCents: d.valueCents,
              })
            }
            disabled={createAddback.isPending}
          >
            Add back
          </Button>
        </div>
        {createAddback.error && (
          <p className="text-severity-critical mt-1.5 text-xs">{createAddback.error.message}</p>
        )}
      </div>
    </div>
  );
}
