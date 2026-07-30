import { cn } from "@/lib/utils";

/** Loading placeholder (M11.1): shimmer over muted surface. Prefer
 *  skeletons that mirror the loaded layout over bare spinners. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="skeleton" className={cn("shimmer rounded-md bg-muted", className)} {...props} />
  );
}

/** The standard text-block rhythm (ui-25): n full-width lines, last at 2/3.
 *  The shape every rail and card body uses while its query is in flight. */
function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 && "w-2/3")} />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonLines };
