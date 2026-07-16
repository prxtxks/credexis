"use client";

/**
 * Review queue UI (M6.4, Blueprint §4.6/§8.2): keyboard-first —
 * [a]ccept · [c]orrect · [r]eject · [s]kip · Enter submits · Esc cancels.
 * Target: <5s median per field. The client RENDERS; it never computes
 * (Iron Law #3) — values arrive as integer-cent strings and are formatted
 * with string operations only.
 *
 * The source-crop panel shows lineage (page, bbox, method, confidence)
 * today; the actual PDF crop image renders once the pipeline (M3.1) writes
 * page images — the bbox data it needs is already here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { formatCents, parseDollarsInput } from "@/lib/money-display";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  error: "#ea580c",
  warning: "#d97706",
};

export default function ReviewPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;

  const utils = trpc.useUtils();
  const queue = trpc.review.queue.useQuery({ dealId });
  const progress = trpc.review.progress.useQuery({ dealId });

  const [cursor, setCursor] = useState(0);
  const [correcting, setCorrecting] = useState(false);
  const [draft, setDraft] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => queue.data ?? [], [queue.data]);
  const current = items[Math.min(cursor, Math.max(items.length - 1, 0))];

  const refresh = useCallback(() => {
    void utils.review.queue.invalidate({ dealId });
    void utils.review.progress.invalidate({ dealId });
    setCorrecting(false);
    setDraft("");
  }, [utils, dealId]);

  const onDone = (message: string) => {
    setFlash(message);
    setTimeout(() => setFlash(null), 1500);
    refresh();
  };

  const accept = trpc.review.accept.useMutation({ onSuccess: () => onDone("accepted") });
  const reject = trpc.review.reject.useMutation({ onSuccess: () => onDone("rejected") });
  const correct = trpc.review.correct.useMutation({ onSuccess: () => onDone("corrected") });

  const busy = accept.isPending || reject.isPending || correct.isPending;

  const submitCorrection = useCallback(() => {
    if (!current) return;
    const cents = parseDollarsInput(draft);
    if (cents === null) {
      setFlash("enter a dollar amount like 36,500.00");
      setTimeout(() => setFlash(null), 1500);
      return;
    }
    correct.mutate({ factId: current.id, correctedCents: cents });
  }, [current, draft, correct]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!current || busy) return;
      if (correcting) {
        if (e.key === "Escape") setCorrecting(false);
        if (e.key === "Enter") submitCorrection();
        return; // typing in the input — no shortcuts
      }
      switch (e.key) {
        case "a":
          accept.mutate({ factId: current.id });
          break;
        case "r":
          reject.mutate({ factId: current.id });
          break;
        case "c":
          setCorrecting(true);
          setTimeout(() => inputRef.current?.focus(), 0);
          break;
        case "s":
          setCursor((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [current, busy, correcting, items.length, accept, reject, submitCorrection]);

  if (queue.isLoading) return <main style={{ padding: 32 }}>Loading review queue…</main>;
  if (queue.error) {
    return <main style={{ padding: 32 }}>Could not load the queue: {queue.error.message}</main>;
  }

  const p = progress.data;

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Review queue</h1>
        {p && (
          <div aria-label="progress" style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, color: "#555" }}>{p.label}</div>
            <div style={{ background: "#e5e7eb", height: 6, borderRadius: 3, marginTop: 4 }}>
              <div
                style={{
                  width: p.total === 0 ? "0%" : `${Math.round((p.done / p.total) * 100)}%`,
                  background: "#059669",
                  height: 6,
                  borderRadius: 3,
                }}
              />
            </div>
          </div>
        )}
      </header>

      {flash && (
        <div role="status" style={{ padding: 8, background: "#ecfdf5", marginBottom: 12 }}>
          {flash}
        </div>
      )}

      {!current ? (
        <section style={{ padding: 32, textAlign: "center", color: "#555" }}>
          <h2>Queue clear 🎉</h2>
          <p>No suggested facts await review for this deal.</p>
        </section>
      ) : (
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {current.topSeverity && (
                <span
                  style={{
                    background: SEVERITY_COLORS[current.topSeverity] ?? "#6b7280",
                    color: "white",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: 12,
                  }}
                >
                  {current.topSeverity}
                </span>
              )}
              <code style={{ fontSize: 13 }}>
                {current.registryFieldId ?? current.taxonomyNodeKey}
              </code>
            </div>

            <div style={{ fontSize: 32, margin: "16px 0", fontVariantNumeric: "tabular-nums" }}>
              {formatCents(current.valueCents)}
            </div>

            {correcting ? (
              <div>
                <label htmlFor="correction" style={{ fontSize: 13 }}>
                  Corrected value
                </label>
                <input
                  id="correction"
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="36,500.00"
                  style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
                />
                <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
                  Enter to save · Esc to cancel
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => accept.mutate({ factId: current.id })} disabled={busy}>
                  <u>a</u>ccept
                </button>
                <button onClick={() => setCorrecting(true)} disabled={busy}>
                  <u>c</u>orrect
                </button>
                <button onClick={() => reject.mutate({ factId: current.id })} disabled={busy}>
                  <u>r</u>eject
                </button>
                <button
                  onClick={() => setCursor((i) => (i + 1) % Math.max(items.length, 1))}
                  disabled={busy}
                >
                  <u>s</u>kip
                </button>
              </div>
            )}

            <div style={{ fontSize: 12, color: "#555", marginTop: 16 }}>
              item {Math.min(cursor + 1, items.length)} of {items.length}
            </div>
          </div>

          <aside style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
            <h2 style={{ fontSize: 14, marginTop: 0 }}>Source</h2>
            <dl style={{ fontSize: 13, lineHeight: 1.8 }}>
              <dt style={{ fontWeight: 600 }}>Method</dt>
              <dd style={{ margin: 0 }}>{current.method}</dd>
              <dt style={{ fontWeight: 600 }}>Confidence</dt>
              <dd style={{ margin: 0 }}>{current.confidence ?? "—"}</dd>
              <dt style={{ fontWeight: 600 }}>Page</dt>
              <dd style={{ margin: 0 }}>{current.sourcePage ?? "—"}</dd>
              <dt style={{ fontWeight: 600 }}>Bounding box</dt>
              <dd style={{ margin: 0 }}>
                {current.sourceBbox
                  ? `x ${current.sourceBbox.x.toFixed(3)} · y ${current.sourceBbox.y.toFixed(3)}`
                  : "—"}
              </dd>
            </dl>
            <div
              style={{
                border: "1px dashed #d1d5db",
                borderRadius: 6,
                padding: 24,
                textAlign: "center",
                color: "#9ca3af",
                fontSize: 12,
              }}
            >
              source crop renders here once the pipeline (M3.1) writes page images — bbox lineage
              above is live
            </div>
          </aside>
        </section>
      )}
    </main>
  );
}
