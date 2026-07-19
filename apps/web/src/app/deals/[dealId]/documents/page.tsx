"use client";

/**
 * Deal documents (M3.1): drag-drop/multi-file upload → storage → documents
 * rows → pipeline. Status polls every 2.5s (Trigger.dev Realtime replaces
 * polling in M8.8). The client renders server truth only.
 */

import { useRef, useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";

const STATUS_COLORS: Record<string, string> = {
  uploaded: "#6b7280",
  processing: "#d97706",
  processed: "#059669",
  failed: "#dc2626",
};

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${n} B`;
}

export default function DocumentsPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const utils = trpc.useUtils();
  const docs = trpc.documents.list.useQuery({ dealId }, { refetchInterval: 2500 });
  const progress = trpc.pipeline.progress.useQuery({ dealId }, { refetchInterval: 2500 });

  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [messages, setMessages] = useState<string[]>([]);

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

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 20 }}>Deal documents</h1>

      <section
        style={{
          border: "2px dashed #d1d5db",
          borderRadius: 8,
          padding: 24,
          textAlign: "center",
          marginBottom: 16,
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void uploadFiles(e.dataTransfer.files);
        }}
      >
        <p style={{ margin: "0 0 8px" }}>
          Drag PDFs / scans / statements here, or
          <button style={{ marginLeft: 6 }} onClick={() => inputRef.current?.click()}>
            choose files
          </button>
        </p>
        <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>
          pdf · png · jpeg · tiff · xlsx — 50 MiB max each
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => void uploadFiles(e.target.files)}
        />
        {uploading && <p style={{ fontSize: 13 }}>Uploading {uploading}…</p>}
      </section>

      {messages.length > 0 && (
        <ul style={{ fontSize: 13, paddingLeft: 18 }}>
          {messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}

      {docs.isLoading ? (
        <p>Loading…</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: 8 }}>File</th>
              <th style={{ padding: 8 }}>Size</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Scan</th>
              <th style={{ padding: 8 }}>Hash</th>
            </tr>
          </thead>
          <tbody>
            {(docs.data ?? []).map((d) => (
              <tr key={d.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: 8 }}>{d.fileName}</td>
                <td style={{ padding: 8 }}>{formatBytes(d.bytes)}</td>
                <td style={{ padding: 8 }}>
                  <span
                    style={{
                      background: STATUS_COLORS[d.status] ?? "#6b7280",
                      color: "white",
                      borderRadius: 4,
                      padding: "2px 8px",
                      fontSize: 12,
                    }}
                  >
                    {d.status}
                  </span>
                </td>
                <td style={{ padding: 8, fontSize: 12 }}>
                  {(progress.data?.[d.id] ?? []).map((s, i) => (
                    <span
                      key={i}
                      title={`${s.stage}: ${s.status}${s.error ? ` — ${s.error}` : ""}${s.model ? ` (${s.model})` : ""}`}
                      style={{
                        display: "inline-block",
                        marginRight: 4,
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontSize: 11,
                        color: "white",
                        background:
                          s.status === "succeeded"
                            ? "#059669"
                            : s.status === "failed"
                              ? "#dc2626"
                              : "#d97706",
                      }}
                    >
                      {s.stage}
                    </span>
                  ))}
                  {(progress.data?.[d.id] ?? []).length === 0 && d.virusScan}
                </td>
                <td style={{ padding: 8 }}>
                  <code style={{ fontSize: 11 }}>{d.sha256Short}</code>
                </td>
              </tr>
            ))}
            {(docs.data ?? []).length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 16, color: "#6b7280" }}>
                  No documents yet — upload the deal&apos;s tax returns and statements above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </main>
  );
}
