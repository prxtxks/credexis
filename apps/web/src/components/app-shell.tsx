"use client";

/**
 * App shell v3 (ui-17, 02-VERCEL-DERIVATION §3.1–3.3): fixed 250px sidebar
 * (Find + grouped nav + identity footer with the bell), slim top bar
 * (centered page title, page actions right), floating Find/menu pill on
 * phones — the reference's chrome, in our tokens. The deal WORKSPACE keeps
 * its own cockpit chrome (X4 e2e contracts live there); this shell wraps
 * everything else.
 *
 * Deliberately absent, matching the reference: sidebar collapse (Vercel's
 * rail is fixed-width), the gradient mesh (canvas is flat near-black; the
 * mesh survives only on auth screens), and the mobile tab bar (retired by
 * 02 §1.4 — the pill + sheet replace it).
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { FindDialog } from "@/components/find-dialog";
import { Logo } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";
import { NAV_MAIN, NAV_ORG, NAV_SETTINGS, isActive, type NavItem } from "@/components/nav-config";
import { NotificationsBell } from "@/components/notifications-bell";
import { cn } from "@/lib/utils";

function NavRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item, pathname);
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors duration-150",
        active
          ? "bg-sidebar-accent text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <item.icon aria-hidden="true" className="size-4 shrink-0" />
      {item.label}
    </Link>
  );
}

export function AppShell({
  breadcrumb,
  actions,
  children,
}: {
  /** Centered top-bar title (page or deal context) — plain text, never a heading. */
  breadcrumb?: string | undefined;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [findOpen, setFindOpen] = useState(false);

  // F opens Find anywhere in the shell (the reference's kbd chip), unless
  // the user is typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "f" && e.key !== "F") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      setFindOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen">
      <FindDialog open={findOpen} onOpenChange={setFindOpen} />

      {/* ── Sidebar ── */}
      <aside
        aria-label="primary navigation"
        className="sticky top-0 z-40 flex h-screen w-[250px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar max-md:hidden"
      >
        <div className="flex h-14 items-center px-4">
          <Logo size="sm" />
        </div>

        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => setFindOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-transparent px-3 text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent/50"
          >
            <svg
              aria-hidden="true"
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <span className="flex-1 text-left">Find</span>
            <kbd className="rounded-md border border-border px-1.5 text-[11px]">F</kbd>
          </button>
        </div>

        {/* Contextual takeover (02 §3.1): inside /settings the rail becomes
            the settings sub-nav under a back header, as the reference does. */}
        {pathname.startsWith("/settings") ? (
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
            <Link
              href="/"
              className="text-foreground mb-2 flex h-9 items-center gap-1 rounded-lg px-1.5 text-sm font-semibold transition-colors duration-150 hover:bg-sidebar-accent/60"
            >
              <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
              <span className="flex-1 text-center">Settings</span>
              <span aria-hidden="true" className="size-4" />
            </Link>
            {NAV_SETTINGS.map((item) => {
              const active =
                item.href === "/settings"
                  ? pathname === "/settings"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center rounded-lg px-2.5 text-sm font-medium transition-colors duration-150",
                    active
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        ) : (
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
            {NAV_MAIN.map((item) => (
              <NavRow key={item.href} item={item} pathname={pathname} />
            ))}
            <div className="my-2 border-t border-sidebar-border" />
            {NAV_ORG.map((item) => (
              <NavRow key={item.href} item={item} pathname={pathname} />
            ))}
          </nav>
        )}

        {/* Identity footer — the reference anchors the person bottom-left,
            with notifications beside them. */}
        <div className="flex items-center gap-1.5 border-t border-sidebar-border p-3">
          <AccountMenu variant="row" />
          <NotificationsBell />
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="frosted-toolbar sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 px-4">
          <span className="md:hidden">
            <Logo size="sm" href="/" iconOnly />
          </span>
          {/* Centered title, as the reference centers "Overview". Absolute so
              left/right clusters don't shift it. */}
          {breadcrumb ? (
            <span className="pointer-events-none absolute inset-x-0 mx-auto w-fit max-w-[50%] truncate text-sm font-medium text-foreground max-md:static max-md:mx-0 max-md:max-w-none max-md:text-[15px] max-md:font-semibold">
              {breadcrumb}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <span className="md:hidden">
              <NotificationsBell />
            </span>
            <span className="md:hidden">
              <AccountMenu />
            </span>
          </div>
        </header>
        <div className="min-w-0 flex-1 max-md:pb-24">{children}</div>
      </div>

      {/* ── Mobile: floating Find/menu pill + nav sheet ── */}
      <MobileNav onFind={() => setFindOpen(true)} />
    </div>
  );
}
