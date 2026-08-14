/**
 * Docs typographic primitives - the enterprise-docs vocabulary (callouts,
 * numbered steps, value tables, keyboard-feel chips). Server-safe except
 * the TOC, which lives in toc.tsx.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Callout({
  kind = "info",
  title,
  children,
}: {
  kind?: "info" | "warn" | "check";
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    info: "border-primary/30 bg-primary/[0.04]",
    warn: "border-severity-warning/40 bg-severity-warning/[0.06]",
    check: "border-border bg-muted/40",
  }[kind];
  const defaultTitle = { info: "Note", warn: "Watch out", check: "Check yourself" }[kind];
  return (
    <div className={cn("my-5 rounded-lg border px-4 py-3 text-[13.5px] leading-6", styles)}>
      <p className="mb-1 text-[12px] font-semibold tracking-wide uppercase opacity-80">
        {title ?? defaultTitle}
      </p>
      <div className="[&>p]:my-1 [&>ul]:my-1">{children}</div>
    </div>
  );
}

export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="relative mt-10 pl-12" id={`step-${n}`}>
      <span
        aria-hidden
        className="bg-primary/10 text-primary absolute top-0.5 left-0 flex h-8 w-8 items-center justify-center rounded-full text-[14px] font-bold tabular-nums"
      >
        {n}
      </span>
      <h3 className="text-foreground scroll-mt-24 text-[17px] font-semibold tracking-tight">
        {title}
      </h3>
      <div className="text-muted-foreground mt-2 space-y-3 text-[14px] leading-7 [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

/** Literal UI text the reader should type or click. */
export function UI({ children }: { children: ReactNode }) {
  return (
    <span className="border-border bg-muted/60 text-foreground rounded-md border px-1.5 py-0.5 font-mono text-[12.5px]">
      {children}
    </span>
  );
}

export function ValueTable({
  caption,
  head,
  rows,
}: {
  caption?: string;
  head: string[];
  rows: (string | ReactNode)[][];
}) {
  return (
    <div className="border-border my-4 overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[420px] text-[13px]">
        {caption ? (
          <caption className="border-border text-muted-foreground border-b px-3 py-2 text-left text-[12px]">
            {caption}
          </caption>
        ) : null}
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td
                  key={j}
                  className={cn("px-3 py-2", j > 0 && "text-right font-mono tabular-nums")}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
