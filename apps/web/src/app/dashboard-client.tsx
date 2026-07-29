"use client";

/**
 * Deal dashboard (M8.7 · redensified ui-14-6, plan 01 §7).
 *
 * ONE DOM that reflows at `md`, never a parallel mobile tree: a duplicate
 * mobile card would give every row a second accessible name (the reason is
 * already documented at deals/[dealId]/borrower/page.tsx).
 *
 * Below `md` the four kanban columns become one scroll list with sticky group
 * headers ordered Review → Parsing → Intake → Complete, so the most urgent
 * work is first. At `md+` the kanban is unchanged.
 *
 * What was deleted and why (plan 01 §1.2): three stat tiles spent ~296px of a
 * 375x812 phone on three numbers — two of which were structurally always zero
 * until deal status became writable — and every empty column rendered a dashed
 * "No deals" box, so a two-deal org scrolled past three placeholders to reach
 * them. The counts now live in the filter that uses them; empty groups render
 * nothing.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { checklistFor } from "@/lib/doc-checklist";
import { formatRatio } from "@/lib/money-display";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Desktop kanban order: the pipeline as a pipeline. */
const COLUMNS = [
  { status: "intake", label: "Intake" },
  { status: "parsing", label: "Parsing" },
  { status: "review", label: "Review" },
  { status: "complete", label: "Complete" },
] as const;

/**
 * Phone list order: most urgent first. A phone is a triage surface, not a
 * pipeline diagram — nobody scrolls past Intake to reach what needs deciding.
 */
const MOBILE_GROUPS = [
  { status: "review", label: "In review" },
  { status: "parsing", label: "Parsing" },
  { status: "intake", label: "Intake" },
  { status: "complete", label: "Complete" },
] as const;

type BoardFilter = "all" | "review" | "complete";

const ENTITY_KINDS = ["applicant", "target", "guarantor", "spouse", "epc", "oc"] as const;
const DEAL_TYPES = ["business_acquisition", "working_capital", "real_estate", "refinance"] as const;

function NewDealWizard({ onDone }: { onDone: (dealId: string) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof DEAL_TYPES)[number]>("business_acquisition");
  const [entities, setEntities] = useState<{ name: string; kind: (typeof ENTITY_KINDS)[number] }[]>(
    [{ name: "", kind: "applicant" }],
  );
  const create = trpc.deals.create.useMutation({ onSuccess: (r) => onDone(r.dealId) });

  return (
    <div className="glass-card rounded-2xl space-y-4 p-6 text-sm">
      <h2 className="text-base font-semibold">New deal</h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="deal-name">Deal name</Label>
          <Input
            id="deal-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Holdings acquisition"
            className="rounded-xl bg-background/50"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-type">Type</Label>
          <FieldSelect
            ariaLabel="Deal type"
            value={type}
            onChange={(v) => setType(v as (typeof DEAL_TYPES)[number])}
            options={DEAL_TYPES.map((t) => ({ value: t, label: t.replaceAll("_", " ") }))}
            size="default"
            className="w-full"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="text-sm font-medium">Entities</span>
        {entities.map((e, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={e.name}
              onChange={(ev) =>
                setEntities(entities.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))
              }
              placeholder="Entity legal name"
              className="rounded-xl bg-background/50"
            />
            <FieldSelect
              ariaLabel="Entity kind"
              value={e.kind}
              onChange={(v) =>
                setEntities(
                  entities.map((x, j) =>
                    j === i ? { ...x, kind: v as (typeof ENTITY_KINDS)[number] } : x,
                  ),
                )
              }
              options={ENTITY_KINDS.map((k) => ({ value: k, label: k }))}
              size="default"
            />
          </div>
        ))}
        <button
          onClick={() => setEntities([...entities, { name: "", kind: "guarantor" }])}
          className="text-xs text-primary underline underline-offset-2"
        >
          + add entity
        </button>
      </div>

      <div className="rounded-xl bg-muted p-3 text-xs">
        <span className="font-semibold">Document checklist for this type:</span>
        <ul className="mt-1 list-inside list-disc text-muted-foreground">
          {checklistFor(type).map((c) => (
            <li key={c.label}>{c.label}</li>
          ))}
        </ul>
      </div>

      <Button
        onClick={() =>
          create.mutate({ name, type, entities: entities.filter((e) => e.name.trim() !== "") })
        }
        disabled={create.isPending || name.trim() === ""}
        className="px-6"
      >
        Create deal
      </Button>
      {create.error && (
        <p role="alert" className="text-xs text-destructive">
          {create.error.message}
        </p>
      )}
    </div>
  );
}

export default function DashboardClient() {
  const router = useRouter();
  const board = trpc.deals.board.useQuery(undefined, { refetchInterval: 15_000 });
  const [showWizard, setShowWizard] = useState(false);
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();

  // M11.2: a signed-in account with no workspace bootstraps at /welcome
  // (replaces the old dead end where every query just said FORBIDDEN).
  const bootstrap = trpc.org.bootstrap.useQuery(undefined, {
    enabled: board.error?.data?.code === "FORBIDDEN",
  });
  useEffect(() => {
    if (bootstrap.data && !bootstrap.data.hasProfile) router.replace("/welcome");
  }, [bootstrap.data, router]);

  const deals = board.data ?? [];
  const counts = {
    all: deals.length,
    review: deals.filter((d) => d.status === "review").length,
    complete: deals.filter((d) => d.status === "complete").length,
  };

  const visible = filter === "all" ? deals : deals.filter((d) => d.status === filter);
  const query = search.trim().toLowerCase();
  const matched =
    query === "" ? visible : visible.filter((d) => d.name.toLowerCase().includes(query));

  return (
    <AppShell breadcrumb="Deals">
      <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6 md:py-8 lg:px-8">
        {/* ── Search + New deal: the first thing on the screen is the work ── */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search deals"
              aria-label="Search deals"
              className="h-9 pl-9"
            />
          </div>
          {/* Icon-only below sm so the row stays one line on a 375px screen;
              the accessible name is identical either way. */}
          <Button onClick={() => setShowWizard((v) => !v)} className="h-9 shrink-0 px-3 sm:px-4">
            <span className="flex items-center gap-1.5">
              {showWizard ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              <span className="max-sm:sr-only">{showWizard ? "Close" : "New deal"}</span>
            </span>
          </Button>
        </div>

        {/* ── The three numbers, as the filter that uses them ──────────────
            They were three cards costing ~296px. A count nobody can act on is
            decoration; the same count as a filter target is a control. */}
        <div
          role="group"
          aria-label="Filter deals"
          className="border-border/60 mt-3 inline-flex rounded-xl border p-0.5"
        >
          {(
            [
              { key: "all", label: "All" },
              { key: "review", label: "Review" },
              { key: "complete", label: "Complete" },
            ] as const
          ).map((tab) => {
            const active = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(tab.key)}
                className={cn(
                  "rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition-colors duration-150",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                <span className="ml-1.5 tabular-nums opacity-70">{counts[tab.key]}</span>
              </button>
            );
          })}
        </div>

        {showWizard && (
          <div className="mt-4 max-w-2xl">
            <NewDealWizard
              onDone={() => {
                setShowWizard(false);
                void utils.deals.board.invalidate();
              }}
            />
          </div>
        )}

        {/* ── Phone: ONE list, sticky group headers, urgent first ────────── */}
        <div className="mt-4 md:hidden">
          {matched.length === 0 ? (
            <FirstRun hasAnyDeal={deals.length > 0} onNew={() => setShowWizard(true)} />
          ) : (
            MOBILE_GROUPS.map((group) => {
              const rows = matched.filter((d) => d.status === group.status);
              // Empty groups render NOTHING — the dashed placeholders were the
              // second-worst offender on this screen.
              if (rows.length === 0) return null;
              return (
                <section key={group.status}>
                  <h2 className="bg-background/95 text-muted-foreground sticky top-14 z-10 py-2 text-[11px] font-semibold tracking-wider uppercase backdrop-blur">
                    {group.label}
                    <span className="text-foreground/70 ml-1.5 tabular-nums">{rows.length}</span>
                  </h2>
                  <ul className="divide-border/60 divide-y">
                    {rows.map((d) => (
                      <DealRow key={d.id} deal={d} />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>

        {/* ── Desktop: the kanban, unchanged ─────────────────────────────── */}
        <div className="mt-6 hidden grid-cols-2 gap-5 md:grid xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const colDeals = matched.filter((d) => d.status === col.status);
            return (
              <section key={col.status}>
                <h2 className="text-muted-foreground mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase">
                  {col.label}
                  <span className="border-border/60 text-foreground/70 rounded-full border px-1.5 py-px text-[11px] font-semibold tabular-nums">
                    {colDeals.length}
                  </span>
                </h2>
                <div className="space-y-3">
                  {colDeals.map((d) => (
                    <DealCard key={d.id} deal={d} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </AppShell>
  );
}

type BoardDeal = {
  id: string;
  name: string;
  type: string;
  status: string;
  openIssues: number;
  formFamilies: string[];
  dscr: { mantissa: string; scale: number; period: string } | null;
};

/** Checklist progress for one deal. Counting, not metric math (Iron Law #3). */
function docProgress(deal: BoardDeal): { have: number; need: number } {
  const checklist = checklistFor(deal.type);
  return {
    have: checklist.filter((c) => c.formFamilies.some((f) => deal.formFamilies.includes(f))).length,
    need: checklist.length,
  };
}

/**
 * The phone row: two lines, ~64px, one <Link> so the accessible name stays the
 * deal name. The card's six visual objects collapse to text — the five
 * checklist dots survive only at md+, because their tooltip is unreachable on
 * touch and "3/5 docs" says the same thing legibly (plan 01 §7).
 */
function DealRow({ deal }: { deal: BoardDeal }) {
  const { have, need } = docProgress(deal);
  return (
    <li>
      <Link
        href={`/deals/${deal.id}/workspace`}
        className="hover:bg-accent/40 relative flex items-center justify-between gap-3 py-3 pl-3 transition-colors duration-150"
      >
        {/* Status is a 2px bar and one amber count — never a coloured row. */}
        {deal.openIssues > 0 && (
          <span
            aria-hidden="true"
            className="bg-severity-warning absolute inset-y-2 left-0 w-0.5 rounded-full"
          />
        )}
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium">{deal.name}</span>
          <span className="text-muted-foreground mt-0.5 block text-[13px]">
            {deal.type.replaceAll("_", " ")} ·{" "}
            <span className="tabular-nums">
              {have}/{need}
            </span>{" "}
            docs
            {deal.openIssues > 0 && (
              <>
                {" · "}
                <span className="text-severity-warning">
                  <span className="tabular-nums">{deal.openIssues}</span>{" "}
                  {deal.openIssues === 1 ? "issue" : "issues"}
                </span>
              </>
            )}
          </span>
        </span>
        {deal.dscr && (
          <span className="shrink-0 text-[15px] font-semibold tabular-nums">
            {formatRatio(deal.dscr.mantissa, deal.dscr.scale)}×
          </span>
        )}
      </Link>
    </li>
  );
}

/** The desktop card, unchanged in substance from ui-2. */
function DealCard({ deal }: { deal: BoardDeal }) {
  const { have, need } = docProgress(deal);
  const checklist = checklistFor(deal.type);
  return (
    <Link href={`/deals/${deal.id}/workspace`} className="group block">
      <div className="glass-card hover:border-primary/40 rounded-xl p-4 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <span className="group-hover:text-primary text-[15px] leading-tight font-semibold transition-colors duration-150">
            {deal.name}
          </span>
          {deal.dscr && (
            <span
              className="border-border/60 bg-muted/60 shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums"
              title={`DSCR ${deal.dscr.period}`}
            >
              {formatRatio(deal.dscr.mantissa, deal.dscr.scale)}×
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="rounded-full px-2.5 text-[11px] font-normal">
            {deal.type.replaceAll("_", " ")}
          </Badge>
          {deal.openIssues > 0 && (
            <span className="bg-severity-warning/10 text-severity-warning inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
              <span className="bg-severity-warning h-1.5 w-1.5 rounded-full" />
              {deal.openIssues} open {deal.openIssues === 1 ? "issue" : "issues"}
            </span>
          )}
        </div>
        <div className="border-border/60 mt-3 flex items-center justify-between border-t pt-2.5">
          <span className="text-muted-foreground text-[11px] tracking-wide">
            DOCUMENTS{" "}
            <span className="text-foreground/80 ml-0.5 font-semibold tabular-nums">
              {have}/{need}
            </span>
          </span>
          <span className="inline-flex gap-0.5">
            {checklist.map((c) => (
              <span
                key={c.label}
                title={c.label}
                className={`inline-block h-1.5 w-3.5 rounded-full transition-colors duration-150 ${
                  c.formFamilies.some((f) => deal.formFamilies.includes(f))
                    ? "bg-primary"
                    : "bg-border"
                }`}
              />
            ))}
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * ONE panel, not four dashed boxes. A brand-new org gets a real first action;
 * a filtered-empty view says so without pretending the workspace is empty.
 */
function FirstRun({ hasAnyDeal, onNew }: { hasAnyDeal: boolean; onNew: () => void }) {
  if (hasAnyDeal) {
    return (
      <p className="text-muted-foreground py-8 text-center text-[13px]">
        No deals match that filter.
      </p>
    );
  }
  return (
    <div className="glass-card rounded-xl p-6 text-center">
      <p className="text-[15px] font-medium">No deals yet</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-[13px]">
        Create a deal, upload the borrower&apos;s returns and statements, and Credexis builds the
        spread and pro-forma from them.
      </p>
      <Button onClick={onNew} className="mt-4">
        <span className="flex items-center gap-1.5">
          <Plus className="h-4 w-4" />
          Create your first deal
        </span>
      </Button>
    </div>
  );
}
