"use client";

/**
 * Source viewer (M8.4 — the hero feature, Blueprint §8.2): the selected
 * cell's PDF page rendered with its bounding box highlighted, full lineage,
 * override + revert, and the explicit addback action with a category
 * picker (V1 hardcoded "other" — fixed). Rendering is pdf.js on a canvas;
 * the bbox overlay is a positioned div over normalized 0..1 coordinates.
 */

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { formatCents, parseDollarsInput } from "@/lib/money-display";
import type { CellSelection } from "./spread-grid";

const ADDBACK_CATEGORIES = [
  "officer_comp",
  "depreciation_amortization",
  "interest",
  "one_time",
  "rent_adjustment",
  "discretionary",
] as const;

function PdfPage({
  url,
  page,
  bbox,
}: {
  url: string;
  page: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

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
        const viewport = pdfPage.getViewport({ scale: 1 });
        const scale = 320 / viewport.width; // panel width
        const scaled = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = scaled.width;
        canvas.height = scaled.height;
        setSize({ w: scaled.width, h: scaled.height });
        await pdfPage.render({
          canvas,
          canvasContext: canvas.getContext("2d")!,
          viewport: scaled,
        }).promise;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, page]);

  if (error) {
    return <p className="text-xs text-severity-critical">PDF render failed: {error}</p>;
  }
  return (
    <div className="relative inline-block">
      <canvas ref={canvasRef} className="rounded border border-border" />
      {bbox && size && (
        <div
          aria-label="source bounding box"
          className="pointer-events-none absolute border-2 border-primary bg-primary/15"
          style={{
            left: bbox.x * size.w,
            top: bbox.y * size.h,
            width: bbox.w * size.w,
            height: bbox.h * size.h,
          }}
        />
      )}
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
    return <p className="text-sm text-severity-critical">{detail.error?.message}</p>;
  }
  const d = detail.data;

  function submitOverride() {
    const cents = parseDollarsInput(draft);
    if (cents === null) return;
    override.mutate({ factId: d.factId, correctedCents: cents });
    setDraft("");
  }

  return (
    <div className="space-y-3 text-sm">
      <header>
        <code className="text-xs">{d.registryFieldId ?? d.taxonomyNodeKey}</code>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{formatCents(d.valueCents)}</div>
        {d.method === "override" && d.originalValueCents !== null && (
          <div className="text-xs text-muted-foreground">
            was {formatCents(d.originalValueCents)}{" "}
            <button
              className="text-primary underline"
              onClick={() => revert.mutate({ overrideFactId: d.factId })}
              disabled={revert.isPending}
            >
              revert
            </button>
          </div>
        )}
      </header>

      {d.document?.signedUrl ? (
        <PdfPage url={d.document.signedUrl} page={d.document.pdfPage} bbox={d.bbox} />
      ) : (
        <div className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground">
          No source render — {d.method === "human" ? "human-entered value" : "no PDF lineage"}.
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
        <dt className="font-semibold">Document</dt>
        <dd className="truncate">{d.document?.fileName ?? "—"}</dd>
        <dt className="font-semibold">Form</dt>
        <dd>
          {d.document?.formFamily ?? "—"} {d.document?.taxYear ?? ""}
        </dd>
        <dt className="font-semibold">Page</dt>
        <dd>{d.document?.pdfPage ?? "—"}</dd>
        <dt className="font-semibold">Method</dt>
        <dd>{d.method}</dd>
        <dt className="font-semibold">Confidence</dt>
        <dd>{d.confidence ?? "—"}</dd>
        <dt className="font-semibold">Status</dt>
        <dd>{d.status}</dd>
      </dl>

      <div className="border-t border-border pt-2">
        <label htmlFor="override" className="text-xs font-semibold">
          Override value
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="override"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="36,500.00"
            className="w-full rounded border border-border px-2 py-1"
            onKeyDown={(e) => e.key === "Enter" && submitOverride()}
          />
          <button
            onClick={submitOverride}
            disabled={override.isPending}
            className="rounded bg-primary px-3 py-1 text-primary-foreground"
          >
            Save
          </button>
        </div>
        {override.error && (
          <p className="mt-1 text-xs text-severity-critical">{override.error.message}</p>
        )}
      </div>

      <div className="border-t border-border pt-2">
        <label htmlFor="addback-category" className="text-xs font-semibold">
          Add back this line
        </label>
        <div className="mt-1 flex gap-2">
          <select
            id="addback-category"
            value={addbackCategory}
            onChange={(e) => setAddbackCategory(e.target.value)}
            className="w-full rounded border border-border px-2 py-1"
          >
            {ADDBACK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              createAddback.mutate({
                dealId,
                factId: d.factId,
                category: addbackCategory as (typeof ADDBACK_CATEGORIES)[number],
                amountCents: d.valueCents,
              })
            }
            disabled={createAddback.isPending}
            className="rounded border border-border px-3 py-1"
          >
            Add back
          </button>
        </div>
        {createAddback.error && (
          <p className="mt-1 text-xs text-severity-critical">{createAddback.error.message}</p>
        )}
      </div>
    </div>
  );
}
