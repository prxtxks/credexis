"use client";

/**
 * Support → Cases (ui-19, matched to the reference dashboard-Support view):
 * search + status/severity filters + New Case, and the case list. Cases
 * persist in THIS BROWSER (localStorage) until a case backend exists - the
 * footer says so plainly. Creating a case happens on /support/new.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MessageCircle, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { readCases, type SupportCase } from "@/lib/support-cases";

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function SupportCasesPage() {
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");

  useEffect(() => {
    setCases(readCases());
  }, []);

  const rows = useMemo(
    () =>
      cases.filter(
        (c) =>
          (q.trim() === "" || c.title.toLowerCase().includes(q.trim().toLowerCase())) &&
          (status === "all" || c.status === status) &&
          (severity === "all" || c.severity === severity),
      ),
    [cases, q, status, severity],
  );

  return (
    <AppShell breadcrumb="Support · Cases">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search cases…"
            aria-label="Search cases"
            className="h-9 flex-1"
          />
          <Button asChild variant="brand" className="h-9 shrink-0">
            <Link href="/support/new">
              <span className="flex items-center gap-1.5">
                <Plus className="size-4" />
                New Case
              </span>
            </Link>
          </Button>
        </div>

        <div className="mt-3 flex gap-2">
          <FieldSelect
            ariaLabel="Filter by status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All Statuses" },
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
            ]}
          />
          <FieldSelect
            ariaLabel="Filter by severity"
            value={severity}
            onChange={setSeverity}
            options={[
              { value: "all", label: "All Severities" },
              { value: "low", label: "Low" },
              { value: "normal", label: "Normal" },
              { value: "high", label: "High" },
            ]}
          />
        </div>

        <div className="glass-card mt-4 rounded-lg">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="border-border bg-popover flex size-10 items-center justify-center rounded-[10px] border">
                <MessageCircle aria-hidden="true" className="text-muted-foreground size-4" />
              </span>
              <p className="mt-4 text-[15px] font-semibold">No Cases</p>
              <p className="text-muted-foreground mt-1 text-[13px]">
                Create a new case to get assistance.
              </p>
              <Button asChild size="sm" className="mt-4">
                <Link href="/support/new">New Case</Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-border/70 divide-y">
              {rows.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.title}</p>
                    <p className="text-muted-foreground mt-0.5 text-[13px]">
                      {c.topic} · opened {relativeTime(c.createdAt)}
                    </p>
                  </div>
                  {c.severity !== "normal" ? (
                    <Pill tone={c.severity === "high" ? "warn" : "neutral"}>{c.severity}</Pill>
                  ) : null}
                  <Pill tone={c.status === "open" ? "accent" : "neutral"}>{c.status}</Pill>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-muted-foreground mt-2 text-[11px]">
          Cases are stored in this browser until the case backend lands - email support@credexis.co
          for anything urgent.
        </p>
      </main>
    </AppShell>
  );
}
