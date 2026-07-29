"use client";

/**
 * Review queue UI (M6.4, Blueprint §4.6/§8.2): keyboard-first —
 * [a]ccept · [c]orrect · [r]eject · [s]kip · Enter submits · Esc cancels.
 * Target: <5s median per field. The client RENDERS; it never computes
 * (Iron Law #3) — values arrive as integer-cent strings and are formatted
 * with string operations only.
 *
 * V1 (UnderlyticsAI) restyle: app shell top bar with a workspace back link
 * and deal-name breadcrumb, a glass-card fact card (severity Badge, mono
 * field-key pill, large tabular-nums value), shadcn Buttons that keep the
 * underline-first-letter shortcut markup, and a glass lineage aside. All
 * behavior — tRPC queries/mutations, keyboard handling, parse logic — is
 * unchanged; only the presentation moved to the shared design system.
 *
 * The source-crop panel shows lineage (page, bbox, method, confidence)
 * today; the actual PDF crop image renders once the pipeline (M3.1) writes
 * page images — the bbox data it needs is already here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { formatCents, parseDollarsInput } from "@/lib/money-display";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { PageLoading } from "@/components/ui/page-loading";

const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-severity-critical text-white",
  error: "bg-severity-critical text-white",
  warning: "bg-severity-warning text-white",
};

export default function ReviewPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;

  const utils = trpc.useUtils();
  const deal = trpc.deals.get.useQuery({ dealId });
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
    toast.success(message);
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

  const shell = (content: React.ReactNode) => (
    <AppShell
      breadcrumb={deal.data?.name ?? "Review queue"}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={`/deals/${dealId}/workspace`}>Back to workspace</Link>
        </Button>
      }
    >
      {content}
    </AppShell>
  );

  if (queue.isLoading) {
    return shell(
      <main className="mx-auto flex max-w-4xl flex-col items-center gap-4 px-4 py-24 sm:px-6 lg:px-8">
        <PageLoading />
        <p className="text-sm text-muted-foreground">Loading review queue…</p>
      </main>,
    );
  }

  if (queue.error) {
    return shell(
      <main className="mx-auto max-w-4xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="glass-card flex items-start gap-3 rounded-xl p-6 text-sm">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-severity-critical" />
          <div>
            <p className="font-medium text-foreground">Could not load the queue</p>
            <p className="mt-1 text-muted-foreground">{queue.error.message}</p>
          </div>
        </div>
      </main>,
    );
  }

  const p = progress.data;

  return shell(
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Review queue</h1>
        {p && (
          <div aria-label="progress" className="mt-3">
            <div className="text-[13px] text-muted-foreground">{p.label}</div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-250 ease-out"
                style={{
                  width: p.total === 0 ? "0%" : `${Math.round((p.done / p.total) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
      </header>

      {flash && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-primary/20 bg-primary/10 px-4 py-2.5 text-sm text-foreground"
        >
          {flash}
        </div>
      )}

      {!current ? (
        <section className="glass-card flex flex-col items-center gap-3 rounded-2xl px-8 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Queue clear 🎉</h2>
          <p className="text-sm text-muted-foreground">
            No suggested facts await review for this deal.
          </p>
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="glass-card rounded-[20px] p-6">
            <div className="flex flex-wrap items-center gap-2">
              {current.topSeverity && (
                <Badge
                  className={cn(
                    "rounded-full border-0 font-normal capitalize",
                    SEVERITY_CLASS[current.topSeverity] ?? "bg-muted text-foreground",
                  )}
                >
                  {current.topSeverity}
                </Badge>
              )}
              <code className="rounded-full bg-muted px-2.5 py-1 font-mono text-[13px] text-muted-foreground">
                {current.registryFieldId ?? current.taxonomyNodeKey}
              </code>
            </div>

            {/* The number under review IS the screen (design language §2):
                Geist tabular at display size — identifiers stay mono, money
                does not. */}
            <div className="my-6 text-[40px] font-semibold leading-none tabular-nums tracking-tight text-foreground">
              {formatCents(current.valueCents)}
            </div>

            {correcting ? (
              <div className="space-y-1.5">
                <Label htmlFor="correction" className="text-xs font-medium text-muted-foreground">
                  Corrected value
                </Label>
                <Input
                  id="correction"
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="36,500.00"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">Enter to save · Esc to cancel</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {/* The label is wrapped in a single <span> so the button
                      (inline-flex) has ONE flex-item child — otherwise
                      Chromium's accessible-name joins the <u> and the text
                      as separate flex items with a space ("a ccept"), which
                      breaks the exact-name e2e contract. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => accept.mutate({ factId: current.id })}
                  disabled={busy}
                >
                  <span>
                    <u>a</u>ccept
                  </span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setCorrecting(true)}
                  disabled={busy}
                >
                  <span>
                    <u>c</u>orrect
                  </span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => reject.mutate({ factId: current.id })}
                  disabled={busy}
                >
                  <span>
                    <u>r</u>eject
                  </span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setCursor((i) => (i + 1) % Math.max(items.length, 1))}
                  disabled={busy}
                >
                  <span>
                    <u>s</u>kip
                  </span>
                </Button>
              </div>
            )}

            <div className="mt-6 text-xs text-muted-foreground">
              item {Math.min(cursor + 1, items.length)} of {items.length}
            </div>
          </div>

          <aside className="glass-card rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-foreground">Source</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
              <dt className="font-medium text-muted-foreground">Method</dt>
              <dd className="m-0 text-foreground">{current.method}</dd>
              <dt className="font-medium text-muted-foreground">Confidence</dt>
              <dd className="m-0 text-foreground">{current.confidence ?? "—"}</dd>
              <dt className="font-medium text-muted-foreground">Page</dt>
              <dd className="m-0 text-foreground">{current.sourcePage ?? "—"}</dd>
              <dt className="font-medium text-muted-foreground">Bounding box</dt>
              <dd className="m-0 font-mono text-foreground">
                {current.sourceBbox
                  ? `x ${current.sourceBbox.x.toFixed(3)} · y ${current.sourceBbox.y.toFixed(3)}`
                  : "—"}
              </dd>
            </dl>
            <div className="mt-4 rounded-xl border border-dashed border-border px-6 py-8 text-center text-xs text-muted-foreground">
              source crop renders here once the pipeline (M3.1) writes page images — bbox lineage
              above is live
            </div>
          </aside>
        </section>
      )}
    </main>,
  );
}
