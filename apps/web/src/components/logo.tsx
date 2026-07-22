import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Credexis wordmark in the V1 lockup: gradient square + BarChart3 mark +
 * Geist semibold name. One component so the brand treatment is decided
 * exactly once (per founder: name reads "Credexis", V1 styling, no
 * mid-word gradient accent).
 */
export function Logo({
  size = "md",
  tagline,
  href = "/",
}: {
  size?: "sm" | "md" | undefined;
  tagline?: string | undefined;
  href?: string | null | undefined;
}) {
  const mark = (
    <>
      <div
        className={cn(
          "flex items-center justify-center rounded-lg gradient-btn",
          size === "sm" ? "w-7 h-7" : "w-8 h-8",
        )}
      >
        <BarChart3 className={cn("text-white", size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4")} />
      </div>
      <div>
        <span
          className={cn("font-semibold tracking-tight", size === "sm" ? "text-base" : "text-lg")}
        >
          Credexis
        </span>
        {tagline ? (
          <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">{tagline}</span>
        ) : null}
      </div>
    </>
  );

  if (href === null) return <div className="flex items-center gap-2.5">{mark}</div>;
  return (
    <Link href={href} className="flex items-center gap-2.5">
      {mark}
    </Link>
  );
}
