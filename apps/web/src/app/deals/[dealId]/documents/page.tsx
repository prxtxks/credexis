"use client";

/**
 * Deal documents (M3.1): drag-drop/multi-file upload → storage → documents
 * rows → pipeline. Status polls every 2.5s (Trigger.dev Realtime replaces
 * polling in M8.8). The client renders server truth only.
 *
 * V1 restyle (ui-3): app shell top bar with a back link to the workspace and
 * the deal name as breadcrumb, gradient-mesh page wash, a dashed drop-zone
 * with a drag-over emerald/scale state, and each document a glass card with a
 * 3px type-colored left border, a status badge, and per-stage chips whose
 * stage NAME stays visible. Upload log stays a glass list keeping the ✓ text.
 * Presentation only — every query, mutation, route, and branch is unchanged.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Upload,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageLoading } from "@/components/ui/page-loading";

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${n} B`;
}

/** File-type identity from the extension — drives the left border + icon. */
function fileKind(name: string): "pdf" | "scanned" | "excel" | "image" | "other" {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "tif" || ext === "tiff") return "scanned";
  if (ext === "xlsx" || ext === "xls") return "excel";
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return "image";
  return "other";
}

const KIND_BORDER: Record<string, string> = {
  pdf: "border-l-red-400",
  scanned: "border-l-orange-400",
  excel: "border-l-emerald-400",
  image: "border-l-blue-400",
  other: "border-l-muted-foreground/40",
};

const KIND_ICON: Record<string, React.ReactNode> = {
  pdf: <FileText className="h-5 w-5 text-red-500" />,
  scanned: <FileText className="h-5 w-5 text-orange-500" />,
  excel: <FileSpreadsheet className="h-5 w-5 text-emerald-600" />,
  image: <ImageIcon className="h-5 w-5 text-blue-500" />,
  other: <FileText className="h-5 w-5 text-muted-foreground" />,
};

type StatusBadge = {
  icon: React.ReactNode;
  variant: "default" | "secondary" | "destructive" | "outline";
};
const DEFAULT_BADGE: StatusBadge = { icon: null, variant: "outline" };
const STATUS_BADGE: Record<string, StatusBadge> = {
  uploaded: DEFAULT_BADGE,
  processing: { icon: <Loader2 className="h-3 w-3 animate-spin" />, variant: "secondary" },
  processed: { icon: <CheckCircle2 className="h-3 w-3" />, variant: "default" },
  failed: { icon: <AlertCircle className="h-3 w-3" />, variant: "destructive" },
};

/** Per-stage chip color by run status. Stage NAME text stays visible. */
function stageChipClass(status: string): string {
  if (status === "succeeded") return "bg-primary text-primary-foreground";
  if (status === "failed") return "bg-severity-critical text-white";
  return "bg-severity-warning text-white";
}

export default function DocumentsPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const utils = trpc.useUtils();
  const deal = trpc.deals.get.useQuery({ dealId });
  const docs = trpc.documents.list.useQuery({ dealId }, { refetchInterval: 2500 });
  const progress = trpc.pipeline.progress.useQuery({ dealId }, { refetchInterval: 2500 });

  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const log: string[] = [];
    for (const file of Array.from(files)) {
      setUploading(file.name);
      const form = new FormData();
      form.append("dealId", dealId);
      form.append("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const body = (await res.json()) as { error?: string };
        if (res.status === 201) log.push(`✓ ${file.name}`);
        else if (res.status === 409) log.push(`↺ ${file.name}: already uploaded to this deal`);
        else log.push(`✗ ${file.name}: ${body.error ?? res.status}`);
      } catch (e) {
        log.push(`✗ ${file.name}: ${(e as Error).message}`);
      }
      setMessages([...log]);
    }
    setUploading(null);
    void utils.documents.list.invalidate({ dealId });
    if (inputRef.current) inputRef.current.value = "";
  }

  const rows = docs.data ?? [];

  return (
    <AppShell
      breadcrumb={deal.data?.name ?? "…"}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={`/deals/${dealId}/workspace`}>Back to workspace</Link>
        </Button>
      }
    >
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Deal documents</h1>
            <p className="text-sm text-muted-foreground">
              Tax returns, financial statements, and scans — every value traces back to one of these
              sources.
            </p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{rows.length} uploaded</span>
        </div>

        {/* ── Drop zone ─────────────────────────────────────────────── */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void uploadFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "group relative cursor-pointer rounded-xl border-2 border-dashed p-7 text-center transition-all duration-300",
            dragOver
              ? "scale-[1.01] border-primary bg-primary/5"
              : "border-border/70 hover:border-primary/50 hover:bg-primary/5",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.xlsx,.xls"
            className="hidden"
            onChange={(e) => void uploadFiles(e.target.files)}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Uploading {uploading}…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors duration-200 group-hover:bg-primary group-hover:text-primary-foreground">
                <Upload className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium">Drop files or click to browse</p>
              <p className="text-xs text-muted-foreground">
                pdf · png · jpeg · tiff · xlsx — 50 MiB max each
              </p>
            </div>
          )}
        </div>

        {/* ── Upload log ────────────────────────────────────────────── */}
        {messages.length > 0 && (
          <ul className="glass-card mt-4 space-y-1 rounded-xl p-3 font-mono text-[13px]">
            {messages.map((m, i) => (
              <li key={i} className="truncate text-foreground">
                {m}
              </li>
            ))}
          </ul>
        )}

        {/* ── Document list ─────────────────────────────────────────── */}
        <div className="mt-6">
          {docs.isLoading ? (
            <div className="flex justify-center py-16">
              <PageLoading />
            </div>
          ) : rows.length === 0 ? (
            <div className="glass-card rounded-lg px-6 py-12 text-center text-sm text-muted-foreground">
              No documents yet — upload the deal&apos;s tax returns and statements above.
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((d) => {
                const kind = fileKind(d.fileName);
                const badge = STATUS_BADGE[d.status] ?? DEFAULT_BADGE;
                const stages = progress.data?.[d.id] ?? [];
                return (
                  <div
                    key={d.id}
                    className={cn(
                      "glass-card overflow-hidden rounded-xl border border-border border-l-[3px] transition-all duration-200 hover:shadow-md",
                      KIND_BORDER[kind],
                    )}
                  >
                    <div className="flex items-start gap-3 p-3.5">
                      <div className="mt-0.5 shrink-0">{KIND_ICON[kind]}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{d.fileName}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <Badge
                            variant={badge.variant}
                            className="h-5 rounded-full px-2 text-[10px] font-normal"
                          >
                            {badge.icon && <span className="mr-1">{badge.icon}</span>}
                            {d.status}
                          </Badge>

                          {/* Per-stage chips — stage NAME text stays visible. */}
                          {stages.map((s, i) => (
                            <span
                              key={i}
                              title={`${s.stage}: ${s.status}${s.error ? ` — ${s.error}` : ""}${s.model ? ` (${s.model})` : ""}`}
                              className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                                stageChipClass(s.status),
                              )}
                            >
                              {s.stage}
                            </span>
                          ))}
                          {stages.length === 0 && d.virusScan && (
                            <span className="text-[10px] text-muted-foreground">{d.virusScan}</span>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
                          <span>{formatBytes(d.bytes)}</span>
                          <code className="text-computed">{d.sha256Short}</code>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-center sm:hidden">
          <Button onClick={() => inputRef.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" />
            Choose files
          </Button>
        </div>
      </main>
    </AppShell>
  );
}
