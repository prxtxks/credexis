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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const doc = await pdfjs.getDocument({ url }).promise;
        const pdfPage = await doc.getPage(Math.min(page, doc.numPages));
        const base = pdfPage.getViewport({ scale: 1 });
        const fitWidth = containerRef.current?.clientWidth ?? 320;
        const cssScale = (fitWidth / base.width) * zoom;
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
  }, [url, page, zoom]);

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
            <div
              aria-label="source bounding box"
              className="border-primary bg-primary/15 pointer-events-none absolute border-2"
              style={{
                left: bbox.x * size.w,
                top: bbox.y * size.h,
                width: bbox.w * size.w,
                height: bbox.h * size.h,
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
          {d.confidence !== null ? <Pill>conf {d.confidence}</Pill> : null}
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
      </dl>

      {/* ── Actions ── */}
      <div className="glass-card rounded-lg p-3.5">
        <label htmlFor="override" className="text-[12px] font-semibold">
          Override value
        </label>
        <div className="mt-1.5 flex gap-2">
          <Input
            id="override"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="36,500.00"
            className="h-8"
            onKeyDown={(e) => e.key === "Enter" && submitOverride()}
          />
          <Button size="sm" variant="brand" onClick={submitOverride} disabled={override.isPending}>
            Save
          </Button>
        </div>
        {override.error && (
          <p className="text-severity-critical mt-1.5 text-xs">{override.error.message}</p>
        )}

        <label htmlFor="addback-category" className="mt-4 block text-[12px] font-semibold">
          Add back this line
        </label>
        <div className="mt-1.5 flex gap-2">
          <FieldSelect
            ariaLabel="Add-back category"
            value={addbackCategory}
            onChange={setAddbackCategory}
            options={ADDBACK_CATEGORIES.map((c) => ({
              value: c,
              label: c.replaceAll("_", " "),
            }))}
            className="w-full"
          />
          <Button
            size="sm"
            variant="outline"
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
