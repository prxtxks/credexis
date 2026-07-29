import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Stat tile (M11.1): glass card with icon square + big value + caption —
 * the dashboard/costs metric block, standardized. Values arrive as
 * SERVER-formatted strings (Iron Law #3: the client renders, never
 * computes — no math, no threshold comparisons here).
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  caption,
  className,
}: {
  icon?: LucideIcon | undefined;
  label: string;
  value: string;
  caption?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("glass-card flex items-center gap-3 rounded-xl p-4", className)}>
      {Icon ? (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="truncate font-mono text-lg font-bold tabular-nums">{value}</p>
        {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
      </div>
    </div>
  );
}
