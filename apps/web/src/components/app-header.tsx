import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Shared frosted top bar (V1 header language). Every page mounts one, so
 * navigation and theme switching exist everywhere — the fix for the
 * "orphan pages with no way back" problem.
 */
export function AppHeader({
  tagline,
  backHref,
  backLabel,
  breadcrumb,
  badges = [],
  children,
  showSignOut = true,
}: {
  tagline?: string;
  /** Optional back link rendered before the logo (e.g. → workspace). */
  backHref?: string;
  backLabel?: string;
  /** Optional context after the logo (e.g. the deal name). */
  breadcrumb?: ReactNode;
  /** Pill badges rendered next to the breadcrumb. */
  badges?: string[];
  /** Right-side extras (links, buttons) before the theme toggle. */
  children?: ReactNode;
  showSignOut?: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 frosted-toolbar">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {backHref ? (
            <Button asChild variant="ghost" size="icon" className="h-9 w-9 rounded-full shrink-0">
              <Link href={backHref} aria-label={backLabel ?? "Back"}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
          <Logo tagline={tagline} />
          {breadcrumb ? (
            <div className="flex items-center gap-2 min-w-0 border-l border-border pl-3">
              <span className="truncate text-sm font-medium">{breadcrumb}</span>
              {badges.map((b) => (
                <Badge key={b} variant="secondary" className="rounded-full font-normal shrink-0">
                  {b}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {children}
          <ThemeToggle />
          {showSignOut ? (
            <form action="/auth/signout" method="post">
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="rounded-full text-muted-foreground"
              >
                <LogOut className="h-4 w-4 mr-1.5" />
                Sign out
              </Button>
            </form>
          ) : null}
        </div>
      </div>
    </header>
  );
}
