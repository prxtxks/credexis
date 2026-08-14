/**
 * Public documentation shell (no auth): slim top bar, structured left nav
 * from docs-nav.ts, wide content well. Same design tokens as the product,
 * so the docs inherit the brand automatically in light and dark.
 */

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DOCS_NAV } from "./docs-nav";

export const metadata: Metadata = {
  title: { default: "Credexis Docs", template: "%s - Credexis Docs" },
  description: "How to run SBA deals on Credexis: documents in, banker-grade pro-forma out.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background min-h-screen">
      {/* ── Top bar ── */}
      <header className="border-border/70 bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link href="/docs" className="flex items-baseline gap-2">
            <span className="text-foreground text-[15px] font-bold tracking-tight">credexis</span>
            <span className="text-muted-foreground text-[13px]">Docs</span>
          </Link>
          <div className="ml-auto flex items-center gap-4 text-[13px]">
            <Link
              href="/login"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              className="bg-primary text-primary-foreground rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-opacity hover:opacity-90"
            >
              Open Credexis
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl px-4 sm:px-6">
        {/* ── Left nav ── */}
        <aside className="border-border/70 sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r py-8 pr-6 md:block">
          <nav className="space-y-7">
            {DOCS_NAV.map((section) => (
              <div key={section.label}>
                <p className="text-foreground mb-2 text-[12px] font-semibold tracking-wide">
                  {section.label}
                </p>
                <ul className="space-y-0.5">
                  {section.items.map((item) =>
                    item.href ? (
                      <li key={item.title}>
                        <Link
                          href={item.href}
                          className="text-muted-foreground hover:text-foreground hover:bg-accent/50 -ml-2 block rounded-md px-2 py-1 text-[13px] transition-colors"
                        >
                          {item.title}
                        </Link>
                      </li>
                    ) : (
                      <li
                        key={item.title}
                        className="text-muted-foreground/50 flex items-center gap-2 py-1 text-[13px]"
                      >
                        {item.title}
                        <span className="border-border text-muted-foreground/70 rounded-full border px-1.5 text-[10px] font-medium">
                          Soon
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* ── Content ── */}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
