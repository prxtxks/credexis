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

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const deals = board.data ?? [];
    return (q === "" ? deals : deals.filter((d) => d.name.toLowerCase().includes(q))).slice(0, 8);
  }, [board.data, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  function go(dealId: string) {
    onOpenChange(false);
    router.push(`/deals/${dealId}/workspace`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Find a deal</DialogTitle>
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
                if (hit) go(hit.id);
              }
            }}
            placeholder="Find a deal…"
            aria-label="Find a deal"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            esc
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {board.isLoading ? (
            <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Loading…</p>
          ) : matches.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
              <span className="flex size-10 items-center justify-center rounded-[10px] border border-border bg-popover">
                <FileSearch aria-hidden="true" className="size-4 text-muted-foreground" />
              </span>
              <p className="text-[13px] text-muted-foreground">
                No deals match &ldquo;{query}&rdquo;.
              </p>
            </div>
          ) : (
            <ul>
              {matches.map((d, i) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => go(d.id)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-150",
                      i === active ? "bg-accent text-foreground" : "text-foreground/80",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {STATUS_LABEL[d.status] ?? d.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Searches deals. Documents and facts join when server search lands.
        </p>
      </DialogContent>
    </Dialog>
  );
}
