/**
 * The nine-dot brand loader (restored ui-18 per Pratik: the deal-open /
 * workspace moment keeps the branded animation; skeletons remain the
 * loading language everywhere else). Plain divs — safe anywhere, including
 * inside a page's own isLoading branch. NEVER put this in a route
 * loading.tsx: segment Suspense boundaries wedged client-query updates in
 * production streaming (see fix-loading-boundary-wedge).
 */
export function GridLoader({ label }: { label?: string }) {
  return (
    <div role="status" aria-label={label ?? "Loading"} className="flex flex-col items-center gap-3">
      <div className="grid-loader" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      {label ? <p className="text-muted-foreground text-[13px]">{label}</p> : null}
    </div>
  );
}
