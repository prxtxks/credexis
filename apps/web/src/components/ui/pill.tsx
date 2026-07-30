import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A metadata pill — bordered, rounded-full, 11px, optional leading glyph.
 *
 * This is the texture that separates a finished product from a wireframe.
 * Vercel's project rows carry their metadata in exactly these: `Preview`,
 * `#148`, a deploy hash with a status dot. We had the same information as
 * dot-separated grey text, which reads as a draft — the pill gives each fact
 * an edge, so the eye can count them without reading them.
 *
 * Deliberately NOT a Badge: Badge is a status word (`Admin`, `deactivated`)
 * with a filled variant. A pill is a neutral container for a fact.
 */
export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  /** `warn` = Vercel's "Needs Attention" orange; `accent` = their "Beta"
   *  blue, in emerald (02-VERCEL-DERIVATION §2). Nothing else. */
  tone?: "neutral" | "warn" | "accent";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "border-border/70 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium",
        tone === "warn" &&
          "text-severity-warning border-severity-warning/40 bg-severity-warning/10",
        tone === "accent" && "text-primary border-primary/40 bg-primary/10",
        tone === "neutral" && "text-foreground/70",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A 6px status dot for use inside a Pill. */
export function PillDot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("size-1.5 rounded-full", className)} />;
}
