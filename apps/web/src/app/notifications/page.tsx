"use client";

/**
 * Notifications page (ui-18, Pratik 2026-07-30: "we need a notifications
 * page… all notifications, archive button, and everything connected to
 * notifications"). Derived from the reference's notification anatomy:
 * underline tabs (Inbox | Archive), bulk actions right, hairline rows with
 * per-row actions on hover.
 *
 * Archive is REAL: the existing `dismissed` state is the archive
 * (setState/archiveAll - no migration). Restore = setState("read").
 */

import { useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Bell, Check, CheckCheck, Settings } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { AppShell } from "@/components/app-shell";
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

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
}

export default function NotificationsPage() {
  const [tab, setTab] = useState<"inbox" | "archived">("inbox");
  const utils = trpc.useUtils();
  const list = trpc.notifications.list.useQuery({ limit: 100, view: tab });
  const count = trpc.notifications.unreadCount.useQuery();

  const refresh = () => {
    void utils.notifications.list.invalidate();
    void utils.notifications.unreadCount.invalidate();
  };
  const setState = trpc.notifications.setState.useMutation({ onSuccess: refresh });
  const markAll = trpc.notifications.markAllRead.useMutation({ onSuccess: refresh });
  const archiveAll = trpc.notifications.archiveAll.useMutation({ onSuccess: refresh });

  const rows = list.data ?? [];
  const unread = count.data?.unread;

  return (
    <AppShell breadcrumb="Notifications">
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-title">Notifications</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Document events, approvals, and borrower activity - the in-app record is always on.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/settings/notifications">
              <span className="flex items-center gap-1.5">
                <Settings className="size-3.5" />
                Preferences
              </span>
            </Link>
          </Button>
        </div>

        {/* ── Tabs + bulk actions ── */}
        <div className="border-border mt-6 flex items-end justify-between gap-3 border-b">
          <div className="flex gap-6">
            {(
              [
                { key: "inbox", label: "Inbox" },
                { key: "archived", label: "Archive" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px border-b-2 pb-2.5 text-[15px] font-medium transition-colors duration-150",
                  tab === t.key
                    ? "border-foreground text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {t.label}
                {t.key === "inbox" ? (
                  <span className="text-muted-foreground ml-1.5 text-[13px] tabular-nums">
                    {unread === undefined ? "…" : unread}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {tab === "inbox" ? (
            <div className="flex gap-1 pb-1.5">
              <Button
                size="xs"
                variant="ghost"
                className="text-muted-foreground gap-1"
                disabled={markAll.isPending || (unread ?? 0) === 0}
                onClick={() => markAll.mutate()}
              >
                <CheckCheck className="h-3 w-3" />
                Mark all read
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="text-muted-foreground gap-1"
                disabled={archiveAll.isPending || rows.length === 0}
                onClick={() => archiveAll.mutate()}
              >
                <Archive className="h-3 w-3" />
                Archive all
              </Button>
            </div>
          ) : null}
        </div>

        {/* ── List ── */}
        <div className="glass-card mt-4 rounded-lg">
          {list.isLoading ? (
            <div className="divide-border/70 divide-y">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3.5">
                  <Skeleton className="mt-1.5 size-2 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <span className="border-border bg-popover flex size-10 items-center justify-center rounded-[10px] border">
                <Bell aria-hidden="true" className="text-muted-foreground size-4" />
              </span>
              <p className="mt-3 text-[15px] font-semibold">
                {tab === "inbox" ? "Inbox zero" : "Nothing archived"}
              </p>
              <p className="text-muted-foreground mt-1 max-w-sm text-[13px]">
                {tab === "inbox"
                  ? "Document events and approvals land here as they happen."
                  : "Archived notifications are kept here, out of the way."}
              </p>
            </div>
          ) : (
            <ul className="divide-border/70 divide-y">
              {rows.map((n) => (
                <li key={n.id} className="group flex items-start gap-3 px-4 py-3.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      KIND_DOT[n.kind] ?? "bg-muted-foreground",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    {n.actionUrl ? (
                      <Link
                        href={n.actionUrl}
                        onClick={() => setState.mutate({ notificationId: n.id, state: "actioned" })}
                        className={cn(
                          "hover:text-primary text-sm font-medium transition-colors duration-150",
                          n.state !== "unread" && "text-foreground/70",
                        )}
                      >
                        {n.title}
                      </Link>
                    ) : (
                      <p
                        className={cn(
                          "text-sm font-medium",
                          n.state !== "unread" && "text-foreground/70",
                        )}
                      >
                        {n.title}
                      </p>
                    )}
                    {n.body ? (
                      <p className="text-muted-foreground mt-0.5 text-[13px]">{n.body}</p>
                    ) : null}
                  </div>
                  <span className="text-muted-foreground shrink-0 text-[11px]">
                    {relativeTime(n.createdAt)}
                  </span>
                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    {tab === "inbox" ? (
                      <>
                        {n.state === "unread" ? (
                          <button
                            type="button"
                            aria-label={`Mark read: ${n.title}`}
                            onClick={() => setState.mutate({ notificationId: n.id, state: "read" })}
                            className="hover:bg-accent text-muted-foreground rounded-md p-1.5 transition-colors duration-150"
                          >
                            <Check className="size-3.5" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Archive: ${n.title}`}
                          onClick={() =>
                            setState.mutate({ notificationId: n.id, state: "dismissed" })
                          }
                          className="hover:bg-accent text-muted-foreground rounded-md p-1.5 transition-colors duration-150"
                        >
                          <Archive className="size-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Restore: ${n.title}`}
                        onClick={() => setState.mutate({ notificationId: n.id, state: "read" })}
                        className="hover:bg-accent text-muted-foreground rounded-md p-1.5 transition-colors duration-150"
                      >
                        <ArchiveRestore className="size-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </AppShell>
  );
}
