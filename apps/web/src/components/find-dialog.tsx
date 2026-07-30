"use client";

/**
 * Find (ui-17, 02-VERCEL-DERIVATION §3.1): the sidebar search — F opens a
 * palette over the deals the client already holds (deals.board is cached by
 * the home screen; filtering a fetched list is selection, not computation).
 *
 * Scope is DEALS ONLY today and the footer says so — plan 01 step 14 bars a
 * pretend-global search until a real `search` router exists. When that
 * lands, this dialog grows sections instead of being replaced.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSearch, Search } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  intake: "Intake",
  parsing: "Parsing",
  review: "In review",
  complete: "Complete",
};

export function FindDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Fetch only while open — the shell mounts this on every route.
  const board = trpc.deals.board.useQuery(undefined, { enabled: open, staleTime: 30_000 });

  // Find is NAVIGATION search (Pratik 2026-07-30): pages first, then deal
  // destinations from the cached board. Deal *content* search lives in the
  // toolbar's "Search deals" input, not here.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nav: { label: string; meta: string; href: string }[] = [
      { label: "Deals", meta: "Page", href: "/" },
      { label: "Logs", meta: "Page", href: "/logs" },
      { label: "Usage", meta: "Page", href: "/costs" },
      { label: "Members", meta: "Page", href: "/members" },
      { label: "Audit log", meta: "Page", href: "/audit" },
      { label: "Support", meta: "Page", href: "/support" },
      { label: "Notifications", meta: "Page", href: "/notifications" },
      { label: "Settings · General", meta: "Settings", href: "/settings" },
      { label: "Notification settings", meta: "Settings", href: "/settings/notifications" },
      { label: "Security", meta: "Settings", href: "/settings/security" },
    ];
    const deals = (board.data ?? []).map((d) => ({
      label: d.name,
      meta: STATUS_LABEL[d.status] ?? d.status,
      href: `/deals/${d.id}/overview`,
    }));
    const all = [...nav, ...deals];
    return (q === "" ? all : all.filter((i) => i.label.toLowerCase().includes(q))).slice(0, 7);
  }, [board.data, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Anchored where the sidebar's Find sits — the panel expands in
        // place over the rail (reference behavior), not center-screen.
        className="top-3 left-3 w-96 max-w-[calc(100vw-1.5rem)] translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-xl p-0 outline-none focus-visible:outline-none data-[state=open]:slide-in-from-left-1 sm:max-w-sm"
      >
        <DialogTitle className="sr-only">Find a page or deal</DialogTitle>
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                const hit = matches[active];
                if (hit) go(hit.href);
              }
            }}
            placeholder="Find a page or deal…"
            aria-label="Find a page or deal"
            className="placeholder:text-muted-foreground h-12 w-full bg-transparent text-sm outline-none focus-visible:outline-none"
          />
          <kbd className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            esc
          </kbd>
        </div>

        <div className="max-h-72 overflow-y-auto p-1">
          {/* Nav entries are static — render them instantly; deal rows join
              when the board query lands (never hide known results behind a
              loading state). */}
          {matches.length === 0 && board.isLoading ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-[13px]">Loading…</p>
          ) : matches.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
              <span className="flex size-10 items-center justify-center rounded-[10px] border border-border bg-popover">
                <FileSearch aria-hidden="true" className="size-4 text-muted-foreground" />
              </span>
              <p className="text-[13px] text-muted-foreground">
                Nothing matches &ldquo;{query}&rdquo;.
              </p>
            </div>
          ) : (
            <ul>
              {matches.map((d, i) => (
                <li key={d.href + d.label}>
                  <button
                    type="button"
                    onClick={() => go(d.href)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-150",
                      i === active ? "bg-accent text-foreground" : "text-foreground/80",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{d.label}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{d.meta}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Jumps to pages and deals. Deal search also lives in the toolbar; documents and facts join
          when server search lands.
        </p>
      </DialogContent>
    </Dialog>
  );
}
