"use client";

/**
 * The borrower's upload control (design 05 §10.4/§10.6).
 *
 * Deliberately small and dumb: it POSTs each file to /api/upload and reports
 * what came back. Every real check - invite liveness, path pinning, quotas,
 * the virus gate - happens server-side and in the database, so nothing here is
 * load-bearing for security and nothing here needs to know a tenant, deal or
 * invite id.
 *
 * Copy rules for this surface: the reader is a small-business owner sending
 * tax returns, not a user of our product. No jargon, no status codes, and
 * never a hint about what the lender already holds - the route answers
 * "received" for a duplicate for exactly that reason.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Mirrors the route's allowlist so the file picker offers the right things. */
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.tif,.tiff,.xlsx,.xls";
const MAX_BYTES = 52_428_800;

type Outcome = { name: string; ok: boolean; message: string };

export function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [, startTransition] = useTransition();

  async function send(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    const results: Outcome[] = [];

    // Sequential, not parallel: a borrower on a phone connection sending five
    // tax returns at once is how you get five timeouts instead of five files.
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        results.push({ name: file.name, ok: false, message: "That file is larger than 50 MB." });
        continue;
      }
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body });
        if (res.ok) {
          results.push({ name: file.name, ok: true, message: "Received" });
        } else {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null;
          results.push({
            name: file.name,
            ok: false,
            message: payload?.error ?? "We couldn't accept that file. Please try again.",
          });
        }
      } catch {
        // A dropped connection is the borrower's most likely failure. Say what
        // to do, not what broke.
        results.push({
          name: file.name,
          ok: false,
          message: "Your connection dropped before we had the whole file. Please try again.",
        });
      }
      setOutcomes([...results]);
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    // Re-render the server component so "What we need" and "What you've sent"
    // reflect what actually landed - the page is the record, not this list.
    if (results.some((r) => r.ok)) startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        id="borrower-files"
        type="file"
        multiple
        accept={ACCEPT}
        disabled={busy}
        onChange={(e) => void send(e.target.files)}
        className="sr-only"
      />
      <div className="flex flex-wrap items-center gap-3">
        {/* One text node, so the accessible name is exactly "Upload" - the e2e
            contract in design 05 §10.6 asserts that string. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {busy ? "Sending…" : "Upload"}
        </button>
        <p className="text-muted-foreground text-xs">
          PDFs, photos or spreadsheets, up to 50 MB each. You can pick several at once.
        </p>
      </div>

      {outcomes.length > 0 && (
        <ul aria-live="polite" className="space-y-1.5 text-sm">
          {outcomes.map((o, i) => (
            <li key={`${o.name}-${i}`} className="flex items-start gap-2">
              <span aria-hidden="true" className={o.ok ? "" : "text-destructive"}>
                {o.ok ? "✓" : "!"}
              </span>
              <span>
                <span className="break-all">{o.name}</span>
                {!o.ok && <span className="text-destructive block text-xs">{o.message}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
