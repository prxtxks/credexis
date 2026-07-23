import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Credexis brand lockup — the real mark from www.credexis.co
 * (public/logo-credexis.svg, native brand green #00b06a) + the "Credexis"
 * wordmark in Geist bold. One component so the brand is decided once and
 * matches the marketing site everywhere it appears.
 *
 * `onColor` renders the mark white (brightness-0 invert) and the wordmark
 * white, for use on a colored/dark surface (e.g. the login brand panel) —
 * exactly how the site shows it on its dark-green nav.
 */
export function Logo({
  size = "md",
  tagline,
  href = "/",
  onColor = false,
}: {
  size?: "sm" | "md" | undefined;
  tagline?: string | undefined;
  href?: string | null | undefined;
  onColor?: boolean | undefined;
}) {
  const mark = (
    <>
      <img
        src="/logo-credexis.svg"
        alt="Credexis"
        className={cn(size === "sm" ? "h-6 w-6" : "h-7 w-7", onColor && "brightness-0 invert")}
      />
      <div>
        <span
          className={cn(
            "font-bold tracking-tight",
            size === "sm" ? "text-lg" : "text-xl",
            onColor && "text-white",
          )}
        >
          Credexis
        </span>
        {tagline ? (
          <span
            className={cn(
              "ml-2 hidden text-xs sm:inline",
              onColor ? "text-white/70" : "text-muted-foreground",
            )}
          >
            {tagline}
          </span>
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
