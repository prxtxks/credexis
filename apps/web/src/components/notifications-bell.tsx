"use client";

/**
 * Notification bell + panel (M11.5): unread badge, popover list, mark
 * read / mark all read, action links. Self-scoped data only (RLS: own
 * rows). Poll-based (30s) — realtime is a later upgrade, per design 02.
 */

import { useState } from "react";
import Link from "next/link";
import { Archive, Bell, CheckCheck, Inbox } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const KIND_DOT: Record<string, string> = {
  member_joined: "bg-primary",
  document_processed: "bg-primary",
  document_failed: "bg-severity-critical",
  identity_review: "bg-severity-warning",
  review_backlog: "bg-severity-warning",
};

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const count = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const list = trpc.notifications.list.useQuery(undefined, { enabled: open });

  const refresh = () => {
    void utils.notifications.unreadCount.invalidate();
    void utils.notifications.list.invalidate();
  };
  const setState = trpc.notifications.setState.useMutation({ onSuccess: refresh });
  const markAll = trpc.notifications.markAllRead.useMutation({ onSuccess: refresh });

  const unread = count.data?.unread ?? 0;

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-full text-muted-foreground"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-severity-critical px-1 font-mono text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </Button>

      {open ? (
        <>
          <button
            aria-label="Close notifications"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          {/* Overlay = surface-2 (design language §2): OPAQUE bg-popover +
              hairline + shadow — text never sits on transparency. Phones:
              fixed full-width sheet under the top bar (an absolute panel
              anchored to the bell overflows the viewport edge). */}
          <div className="fixed inset-x-3 top-16 z-50 rounded-xl border border-border bg-popover p-2 shadow-xl md:absolute md:inset-x-auto md:top-auto md:right-0 md:mt-2 md:w-96">
            <div className="flex items-center justify-between px-2 py-1.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Notifications
              </h2>
              {unread > 0 ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="gap-1 text-muted-foreground"
                  onClick={() => markAll.mutate()}
                >
                  <CheckCheck className="h-3 w-3" />
                  Mark all read
                </Button>
              ) : null}
            </div>

            <div className="scroll-pane max-h-96 overflow-y-auto">
              {list.isLoading ? (
                <div className="space-y-1 px-2 py-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex gap-2.5 px-2 py-2">
                      <Skeleton className="mt-1.5 size-2 rounded-full" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (list.data ?? []).length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <Inbox className="h-6 w-6 text-muted-foreground/60" />
                  <p className="text-xs text-muted-foreground">
                    Nothing yet — document events and approvals land here.
                  </p>
                </div>
              ) : (
                (list.data ?? []).map((n) => {
                  const archiveBtn = (
                    <button
                      type="button"
                      aria-label={`Archive: ${n.title}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setState.mutate({ notificationId: n.id, state: "dismissed" });
                      }}
                      className="hover:bg-accent text-muted-foreground absolute top-1.5 right-1.5 rounded-md p-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    >
                      <Archive className="h-3 w-3" />
                    </button>
                  );
                  const inner = (
                    <div
                      className={cn(
                        "group relative flex gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-200 hover:bg-accent/50",
                        n.state === "unread" ? "" : "opacity-60",
                      )}
                    >
                      {archiveBtn}
                      <span
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          KIND_DOT[n.kind] ?? "bg-muted-foreground",
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-medium">{n.title}</p>
                        {n.body ? (
                          <p className="truncate text-[11px] text-muted-foreground">{n.body}</p>
                        ) : null}
                        <p className="text-[10px] text-muted-foreground/70">
                          {new Date(n.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  );
                  return n.actionUrl ? (
                    <Link
                      key={n.id}
                      href={n.actionUrl}
                      onClick={() => {
                        setState.mutate({ notificationId: n.id, state: "actioned" });
                        setOpen(false);
                      }}
                      className="block"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <button
                      key={n.id}
                      onClick={() => setState.mutate({ notificationId: n.id, state: "read" })}
                      className="block w-full"
                    >
                      {inner}
                    </button>
                  );
                })
              )}
            </div>

            <div className="border-border/70 border-t px-2 pt-1.5 pb-0.5">
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground block rounded-lg px-2 py-1.5 text-xs transition-colors duration-150"
              >
                View all notifications →
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
