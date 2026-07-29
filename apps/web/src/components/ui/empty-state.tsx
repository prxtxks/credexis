import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Empty state (M11.1): icon tile + REAL heading + next action. The title
 * always renders as a heading element — several e2e specs assert empty
 * states by heading role (e.g. /Queue clear/), so `as` defaults to h2 and
 * must stay a heading tag (X4 contract).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  as: Heading = "h2",
  className,
}: {
  icon?: LucideIcon | undefined;
  title: string;
  description?: string | undefined;
  action?: React.ReactNode;
  as?: "h1" | "h2" | "h3" | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-6 w-6" />
        </div>
      ) : null}
      <Heading className="text-base font-semibold">{title}</Heading>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
