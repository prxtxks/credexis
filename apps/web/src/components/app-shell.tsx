"use client";

/**
 * App shell v2 (ui-7, design 03 §2 — Vercel/Linear-class): persistent
 * left sidebar (nav + collapse) and a slim top bar (breadcrumb slot,
 * bell, theme, sign out) for every page-style surface. The deal
 * WORKSPACE deliberately keeps its own cockpit chrome (X4 e2e contracts
 * live there); this shell wraps everything else. Collapse state is a
 * cookie-free useState — persistence intentionally cut (verdict CUT:
 * user_prefs table is ceremony pre-pilot).
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  Coins,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { NotificationsBell } from "@/components/notifications-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Deals", icon: Briefcase, exact: true },
  { href: "/org/members", label: "Members", icon: Users, exact: false },
  { href: "/costs", label: "Costs", icon: Coins, exact: false },
  { href: "/settings", label: "Settings", icon: Settings, exact: false },
];

export function AppShell({
  breadcrumb,
  actions,
  children,
}: {
  /** Top-bar context (e.g. deal name) — plain text, never a heading. */
  breadcrumb?: string | undefined;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar ── */}
      <aside
        aria-label="primary navigation"
        className={cn(
          "sticky top-0 z-40 flex h-screen shrink-0 flex-col border-r border-border bg-sidebar transition-all duration-200 max-md:hidden",
          open ? "w-56" : "w-14",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center border-b border-border",
            open ? "px-4" : "justify-center",
          )}
        >
          {open ? <Logo size="sm" /> : <Logo size="sm" href="/" iconOnly />}
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors duration-200",
                  active
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  !open && "justify-center px-0",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {open ? label : null}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-2">
          <button
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-center rounded-lg py-2 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            {open ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="frosted-toolbar sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 px-4">
          {/* Mobile: no sidebar — show the wordmark for orientation. */}
          <span className="md:hidden">
            <Logo size="sm" />
          </span>
          {breadcrumb ? (
            <span className="truncate text-sm text-muted-foreground max-sm:hidden">
              {breadcrumb}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <NotificationsBell />
            <ThemeToggle />
            <form action="/auth/signout" method="post">
              <Button
                variant="ghost"
                size="sm"
                type="submit"
                className="gap-1.5 rounded-full text-muted-foreground"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <div className="gradient-mesh min-w-0 flex-1 max-md:pb-20">{children}</div>
      </div>

      {/* ── Mobile bottom tabs (iOS pattern, M11.8) — phones only ── */}
      <nav
        aria-label="mobile navigation"
        className="frosted-toolbar fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors duration-200",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
