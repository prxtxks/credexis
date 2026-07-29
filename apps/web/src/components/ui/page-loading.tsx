/**
 * The ONE loading surface. Every route uses it, at the same offset, so
 * navigation never jumps.
 *
 * The bug this fixes: `deals/[dealId]/loading.tsx` rendered a centred loader
 * while the route segment loaded, then the page's own `isLoading` branch
 * rendered a second one with different padding — so opening the review queue
 * showed a spinner mid-screen, then snapped it to the upper third. Two
 * loaders in two places is one loader too many.
 *
 * Top-aligned on purpose: the content that replaces it starts at the top of
 * the container, so a centred spinner guarantees a jump no matter how the
 * padding is tuned.
 */

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      // pt-16 matches the vertical rhythm of a page's first content block, so
      // the swap from loader to content moves nothing.
      className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 pt-16 sm:px-6 lg:px-8"
    >
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
      <p className="text-muted-foreground text-[13px]">{label}</p>
    </div>
  );
}
