"use client";

/**
 * Notifications page (ui-18, widened + illustrated empty states in ui-22).
 * Derived from the reference's notification anatomy: underline tabs
 * (Inbox | Archive), bulk actions right, hairline rows with per-row
 * actions on hover. Page width matches Members/Settings (max-w-5xl).
 *
 * Archive is REAL: the existing `dismissed` state is the archive
 * (setState/archiveAll - no migration). Restore = setState("read").
 */

import { useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Check, CheckCheck, Settings } from "lucide-react";
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

/**
 * Empty-state illustrations, drawn from the design tokens so they hold up
 * in both themes: an inbox tray under a brand-emerald "caught up" badge,
 * and a resting archive box. Pure SVG - no assets to load.
 */
function InboxZeroArt() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className="size-28">
      <defs>
        <radialGradient id="nz-glow" cx="0.5" cy="0.45" r="0.55">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="54" fill="url(#nz-glow)" />
      <rect
        x="34"
        y="30"
        width="38"
        height="24"
        rx="4"
        fill="var(--popover)"
        stroke="var(--border)"
        transform="rotate(-8 53 42)"
      />
      <rect
        x="50"
        y="26"
        width="38"
        height="24"
        rx="4"
        fill="var(--popover)"
        stroke="var(--border)"
        transform="rotate(6 69 38)"
      />
      <path
        d="M28 60h18l6 9h16l6-9h18v26a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6z"
        fill="var(--card)"
        stroke="var(--border)"
      />
      <path d="M31 60 42 42h36l11 18" fill="none" stroke="var(--border)" />
      <circle cx="90" cy="32" r="12" fill="var(--primary)" />
      <path
        d="m84.5 32 3.8 3.8 7-7.6"
        stroke="#fff"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArchiveRestArt() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className="size-28">
      <defs>
        <radialGradient id="na-glow" cx="0.5" cy="0.45" r="0.55">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.16" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="54" fill="url(#na-glow)" />
      <rect x="30" y="38" width="60" height="16" rx="4" fill="var(--card)" stroke="var(--border)" />
      <path
        d="M36 54h48v28a6 6 0 0 1-6 6H42a6 6 0 0 1-6-6z"
        fill="var(--popover)"
        stroke="var(--border)"
      />
      <rect x="49" y="61" width="22" height="6" rx="3" fill="var(--primary)" opacity="0.55" />
      <circle cx="92" cy="30" r="2.2" fill="var(--primary)" opacity="0.5" />
      <circle cx="100" cy="40" r="1.6" fill="var(--primary)" opacity="0.35" />
      <circle cx="24" cy="46" r="1.6" fill="var(--primary)" opacity="0.3" />
    </svg>
  );
}

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
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
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
            <div className="flex flex-col items-center px-6 py-16 text-center">
              {tab === "inbox" ? <InboxZeroArt /> : <ArchiveRestArt />}
              <p className="mt-4 text-base font-semibold">
                {tab === "inbox" ? "You're all caught up" : "The archive is empty"}
              </p>
              <p className="text-muted-foreground mt-1 max-w-sm text-[13px]">
                {tab === "inbox"
                  ? "New document events, approvals, and borrower activity will land here the moment they happen."
                  : "Notifications you archive rest here - restore any of them whenever you need the trail back."}
              </p>
            </div>
          ) : (
            <ul className="divide-border/70 divide-y">
              {rows.map((n) => (
                <li
                  key={n.id}
                  className="group hover:bg-accent/30 flex items-start gap-3 px-4 py-3.5 transition-colors duration-150"
                >
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
