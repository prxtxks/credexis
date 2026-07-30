import { Skeleton } from "@/components/ui/skeleton";

/**
 * The ONE loading surface (ui-17-feedback: skeletons, not spinners — the
 * reference paints the page's anatomy immediately and pulses it). Every
 * route that hasn't shipped a bespoke skeleton uses this generic page
 * shape: a title line, a toolbar line, then a grouped list surface.
 *
 * Top-aligned on purpose: the content that replaces it starts at the top
 * of the container, so the swap moves nothing (the two-loaders-two-offsets
 * bug this file originally fixed stays fixed — and the doubled
 * "Loading…"/"Loading workspace…" text is gone with the label).
 *
 * `data-slot="page-skeleton"` is the outage-detector hook: prod-smoke's
 * expectNoStuckFallback asserts ZERO of these remain after hydration.
 */
export function PageLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      data-slot="page-skeleton"
      className="mx-auto w-full max-w-5xl px-4 pt-8 sm:px-6 lg:px-8"
    >
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-72" />
      <div className="border-border bg-card mt-6 rounded-lg border">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="border-border/70 flex items-center gap-3 border-b px-4 py-3.5 last:border-b-0"
          >
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
