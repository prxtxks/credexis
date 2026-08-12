/**
 * FailureNotice (M18): when the system cannot process something, it says
 * so in plain language, links the docs page for that failure class, and
 * offers one-click reporting - never a silent dead end. Reputation rule:
 * an honest "we could not read this" beats a quiet wrong answer.
 *
 * Slugs are STABLE API: the docs site (being built) publishes one page
 * per code at docs.credexis.co/errors/<code>.
 */

import Link from "next/link";
import { AlertTriangle, ExternalLink, MessageSquareWarning } from "lucide-react";
import { cn } from "@/lib/utils";

const DOCS_ERRORS_BASE = "https://docs.credexis.co/errors";

export type FailureCode =
  | "no-readable-content"
  | "unsupported-form-year"
  | "encrypted-document"
  | "processing-failed";

/** Map a pipeline error string to its failure class. Unknown → generic. */
export function failureCode(error: string | null | undefined): FailureCode {
  const e = (error ?? "").toLowerCase();
  if (e.includes("no readable content") || e.includes("no text layer")) {
    return "no-readable-content";
  }
  if (e.includes("no registry entry")) return "unsupported-form-year";
  if (e.includes("encrypted") || e.includes("password")) return "encrypted-document";
  return "processing-failed";
}

const LEAD: Record<FailureCode, string> = {
  "no-readable-content":
    "We couldn't read this file - it has no text layer and its pages couldn't be rendered. A clearer scan or the original (non-scanned) PDF will process normally.",
  "unsupported-form-year":
    "This form and year isn't in the extraction registry yet, so no values were read from it. The document is stored and labeled - it can be re-processed the day support lands.",
  "encrypted-document":
    "This PDF is protected and can't be opened by the pipeline. Remove the password and upload again.",
  "processing-failed":
    "Processing stopped partway. The run log records exactly where - the same trail our team sees.",
};

export function FailureNotice({
  code,
  message,
  context,
  className,
}: {
  code: FailureCode;
  /** The raw pipeline error - shown small, never hidden. */
  message?: string | null;
  /** What failed (file name, span) - prefills the support case. */
  context?: string;
  className?: string;
}) {
  const report = new URLSearchParams({
    topic: "bug",
    draft: `Document processing issue (${code})${context ? ` on "${context}"` : ""}${
      message ? `: ${message}` : ""
    }`,
  });
  return (
    <div
      role="status"
      className={cn(
        "border-severity-critical/30 bg-severity-critical/5 rounded-lg border p-3",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          aria-hidden="true"
          className="text-severity-critical mt-0.5 size-4 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug">{LEAD[code]}</p>
          {message ? (
            <p className="text-muted-foreground mt-1 font-mono text-[11px] break-words">
              {message}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <a
              href={`${DOCS_ERRORS_BASE}/${code}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-[12px] font-medium transition-colors duration-150"
            >
              Learn more
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
            <Link
              href={`/support/new?${report.toString()}`}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[12px] font-medium transition-colors duration-150"
            >
              <MessageSquareWarning aria-hidden="true" className="size-3" />
              Report an issue
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
