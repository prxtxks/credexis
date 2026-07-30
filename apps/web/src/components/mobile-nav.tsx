"use client";

/**
 * Mobile navigation (ui-17, 02-VERCEL-DERIVATION §3.3): the floating
 * `Find | ≡` pill + full nav sheet, replacing the iOS tab bar (retired by
 * 02 §1.4). The pill is the reference's exact affordance: Find on the
 * left, menu on the right, × while the sheet is open.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search, X } from "lucide-react";
import { NAV_MAIN, NAV_ORG, isActive } from "@/components/nav-config";
import { cn } from "@/lib/utils";

export function MobileNav({ onFind }: { onFind: () => void }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Route change closes the sheet — navigating from inside it must not
  // leave a full-screen scrim over the destination.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // The sheet owns the scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="md:hidden">
      {open ? (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        />
      ) : null}

      {open ? (
        <nav
          aria-label="mobile navigation"
          className="fixed inset-x-3 top-16 bottom-20 z-40 overflow-y-auto rounded-2xl border border-border bg-popover p-2 shadow-lg"
        >
          {NAV_MAIN.map((item) => {
            const active = isActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors duration-150",
                  active ? "bg-accent text-foreground" : "text-foreground/75",
                )}
              >
                <item.icon aria-hidden="true" className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
          <div className="my-2 border-t border-border" />
          {NAV_ORG.map((item) => {
            const active = isActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors duration-150",
                  active ? "bg-accent text-foreground" : "text-foreground/75",
                )}
              >
                <item.icon aria-hidden="true" className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center overflow-hidden rounded-full border border-border bg-popover shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onFind();
            }}
            className="flex h-12 items-center gap-2 pr-4 pl-5 text-sm font-medium text-foreground/85 transition-colors duration-150 active:bg-accent"
          >
            <Search aria-hidden="true" className="size-4" />
            Find
          </button>
          <span aria-hidden="true" className="h-6 w-px bg-border" />
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-12 items-center pr-5 pl-4 text-foreground/85 transition-colors duration-150 active:bg-accent"
          >
            {open ? (
              <X aria-hidden="true" className="size-5" />
            ) : (
              <Menu aria-hidden="true" className="size-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
