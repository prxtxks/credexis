"use client";

/**
 * Deal dashboard (M8.7 · rebuilt ui-17-deals-home, 02-VERCEL-DERIVATION §4).
 *
 * Desktop is the reference's Overview: one toolbar row (search · filter/sort
 * menu · view toggle · New deal), a left rail (Usage from pipeline.costs,
 * Recent activity from audit.list - both REAL data or absent), and a
 * projects-style deal grid with a list alternative. The kanban is retired:
 * status lives in the dot, the ring, and the filter - not in four columns
 * that were two-thirds empty at eight deals.
 *
 * Phone keeps the ui-14-6 shape (one urgency-ordered list, counts as
 * filter) - it shipped days ago and matches the reference's mobile home.
 *
 * ONE DOM that reflows at `md`, never a parallel mobile tree (the reason is
 * documented at deals/[dealId]/borrower/page.tsx).
 *
 * Iron-law notes: every number here is server truth re-rendered (counting
 * fetched rows is selection, not metric math); the usage card's over-budget
 * tint comes from the server's `overEnvelope` flag, never a client
 * threshold (Iron Law #8).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  LayoutDashboard,
  LayoutGrid,
  ListFilter,
  List as ListIcon,
  MoreHorizontal,
  Plus,
  Search,
  Star,
  Table2,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { checklistFor } from "@/lib/doc-checklist";
import { formatMicroUsd, formatRatio } from "@/lib/money-display";
import { AppShell } from "@/components/app-shell";
import { Pill, PillDot } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { List } from "@/components/ui/list";
import { SectionHeader } from "@/components/ui/section-header";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton, SkeletonLines } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Phone list order: most urgent first - a phone is a triage surface. */
const MOBILE_GROUPS = [
  { status: "review", label: "In review" },
  { status: "parsing", label: "Parsing" },
  { status: "intake", label: "Intake" },
  { status: "complete", label: "Complete" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  intake: "Intake",
  parsing: "Parsing",
  review: "In review",
  complete: "Complete",
};

type BoardFilter = "all" | "intake" | "parsing" | "review" | "complete";
type BoardSort = "activity" | "name";
type BoardView = "grid" | "list";

const VIEW_STORAGE_KEY = "credexis-deals-view";
const PIN_STORAGE_KEY = "credexis-pinned-deals";

/** Pinned deals (ui-17: Pratik queue item) - a per-browser preference, so
 *  localStorage is the right home; ordering is presentation, not truth. */
function usePinnedDeals() {
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIN_STORAGE_KEY);
      if (raw) setPinned(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* corrupt store → start empty */
    }
  }, []);
  function toggle(dealId: string) {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }
  return { pinned, toggle };
}

const ENTITY_KINDS = ["applicant", "target", "guarantor", "spouse", "epc", "oc"] as const;
const DEAL_TYPES = ["business_acquisition", "working_capital", "real_estate", "refinance"] as const;

const TYPE_META: Record<(typeof DEAL_TYPES)[number], { label: string; hint: string }> = {
  business_acquisition: { label: "Business acquisition", hint: "Buying an operating company" },
  working_capital: { label: "Working capital", hint: "Operating liquidity" },
  real_estate: { label: "Real estate", hint: "Owner-occupied CRE" },
  refinance: { label: "Refinance", hint: "Restructure existing debt" },
};

const WIZARD_STEPS = ["Loan type", "Deal & parties", "Review"] as const;

/**
 * In-page New-deal wizard (ui-23, Pratik: "we want a moving form in the
 * dashboard space itself"). The board animates out, this panel animates in,
 * and steps slide by direction. Same mutation, same fields - split across
 * three slides with a Next button instead of one dialog.
 */
function NewDealWizard({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof DEAL_TYPES)[number]>("business_acquisition");
  const [entities, setEntities] = useState<{ name: string; kind: (typeof ENTITY_KINDS)[number] }[]>(
    [{ name: "", kind: "applicant" }],
  );
  const create = trpc.deals.create.useMutation({ onSuccess: () => onDone() });

  const go = (d: 1 | -1) => {
    setDir(d);
    setStep((s) => Math.min(WIZARD_STEPS.length - 1, Math.max(0, s + d)));
  };
  const nameOk = name.trim() !== "";
  const named = entities.filter((e) => e.name.trim() !== "");

  return (
    <section className="anim-panel-in mx-auto max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-title">New deal</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Step {step + 1} of {WIZARD_STEPS.length} - {WIZARD_STEPS[step]}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {/* ── Step progress ── */}
      <div className="mt-4 grid grid-cols-3 gap-2" aria-hidden="true">
        {WIZARD_STEPS.map((label, i) => (
          <div key={label}>
            <div
              className={cn(
                "h-1 rounded-full transition-colors duration-300",
                i <= step ? "bg-primary" : "bg-border",
              )}
            />
            <p
              className={cn(
                "mt-1.5 text-[11px] font-medium",
                i === step ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </p>
          </div>
        ))}
      </div>

      <div className="glass-card mt-5 overflow-hidden rounded-xl p-6">
        <div key={step} className={cn("text-sm", dir === 1 ? "anim-step-fwd" : "anim-step-back")}>
          {step === 0 ? (
            <fieldset>
              <legend className="text-sm font-medium">
                What kind of loan is this? The document checklist follows the type.
              </legend>
              <div
                role="radiogroup"
                aria-label="Deal type"
                className="mt-3 grid gap-2 sm:grid-cols-2"
              >
                {DEAL_TYPES.map((value) => {
                  const t = TYPE_META[value];
                  const active = type === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setType(value)}
                      className={cn(
                        "rounded-lg border p-4 text-left transition-colors duration-150",
                        active
                          ? "border-primary/60 bg-primary/10"
                          : "border-border hover:border-primary/30 hover:bg-accent/40",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex size-3.5 items-center justify-center rounded-full border",
                            active ? "border-primary" : "border-border",
                          )}
                        >
                          {active ? <span className="bg-primary size-2 rounded-full" /> : null}
                        </span>
                        <span className="text-[13px] font-semibold">{t.label}</span>
                      </span>
                      <span className="text-muted-foreground mt-1 block pl-5.5 text-[11px]">
                        {t.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="bg-accent/30 mt-4 rounded-lg p-3">
                <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                  This type expects
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {checklistFor(type).map((c) => (
                    <Pill key={c.label}>{c.label}</Pill>
                  ))}
                </div>
              </div>
            </fieldset>
          ) : step === 1 ? (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="deal-name">Deal name</Label>
                <Input
                  id="deal-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Holdings acquisition"
                />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Entities
                    <span className="text-muted-foreground ml-1.5 text-[13px] tabular-nums">
                      {entities.length}
                    </span>
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground gap-1"
                    onClick={() => setEntities([...entities, { name: "", kind: "guarantor" }])}
                  >
                    <Plus className="h-3 w-3" />
                    Add entity
                  </Button>
                </div>
                <div className="border-border divide-border/70 divide-y rounded-lg border">
                  {entities.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 p-2">
                      <Input
                        value={e.name}
                        aria-label={`Entity ${i + 1} legal name`}
                        onChange={(ev) =>
                          setEntities(
                            entities.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)),
                          )
                        }
                        placeholder={i === 0 ? "Applicant legal name" : "Entity legal name"}
                        className="border-0 bg-transparent shadow-none"
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
                      />
                      <button
                        type="button"
                        aria-label={`Remove entity ${i + 1}`}
                        disabled={entities.length === 1}
                        onClick={() => setEntities(entities.filter((_, j) => j !== i))}
                        className="hover:bg-accent text-muted-foreground rounded-md p-1.5 transition-colors duration-150 disabled:opacity-30"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <dl className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground text-[13px]">Deal name</dt>
                  <dd className="text-right font-medium">{name.trim() === "" ? "-" : name}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground text-[13px]">Loan type</dt>
                  <dd className="text-right font-medium">{TYPE_META[type].label}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground text-[13px]">Entities</dt>
                  <dd className="text-right">
                    {named.length === 0 ? (
                      <span className="text-muted-foreground">None named yet</span>
                    ) : (
                      named.map((e) => (
                        <span key={e.name + e.kind} className="block font-medium">
                          {e.name} <span className="text-muted-foreground">({e.kind})</span>
                        </span>
                      ))
                    )}
                  </dd>
                </div>
              </dl>
              <div className="bg-accent/30 rounded-lg p-3">
                <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                  Document checklist to collect
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {checklistFor(type).map((c) => (
                    <Pill key={c.label}>{c.label}</Pill>
                  ))}
                </div>
              </div>
              {create.error && (
                <p role="alert" className="text-destructive text-xs">
                  {create.error.message}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-border -mx-6 -mb-6 mt-6 flex items-center justify-between border-t px-6 py-4">
          <Button variant="outline" size="sm" disabled={step === 0} onClick={() => go(-1)}>
            Back
          </Button>
          {step < WIZARD_STEPS.length - 1 ? (
            <Button
              size="sm"
              variant="brand"
              disabled={step === 1 && !nameOk}
              onClick={() => go(1)}
            >
              Next
            </Button>
          ) : (
            <Button
              size="sm"
              variant="brand"
              onClick={() => create.mutate({ name, type, entities: named })}
              disabled={create.isPending || !nameOk}
            >
              {create.isPending ? "Creating…" : "Create deal"}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

export default function DashboardClient() {
  const router = useRouter();
  const board = trpc.deals.board.useQuery(undefined, { refetchInterval: 15_000 });
  // "leaving" is the one-render window where the board plays its exit
  // animation; animationend flips to "wizard" (globals.css keeps the
  // animation 1ms under reduced motion so the handoff always fires).
  const [mode, setMode] = useState<"board" | "leaving" | "wizard">("board");
  const openWizard = () => setMode("leaving");
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [sort, setSort] = useState<BoardSort>("activity");
  const [view, setView] = useState<BoardView>("grid");
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();
  const { pinned, toggle: togglePin } = usePinnedDeals();

  // View preference survives reloads; reading localStorage in an effect
  // keeps SSR markup stable.
  useEffect(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "list" || stored === "grid") setView(stored);
  }, []);
  function pickView(v: BoardView) {
    setView(v);
    localStorage.setItem(VIEW_STORAGE_KEY, v);
  }

  // M11.2: a signed-in account with no workspace bootstraps at /welcome.
  const bootstrap = trpc.org.bootstrap.useQuery(undefined, {
    enabled: board.error?.data?.code === "FORBIDDEN",
  });
  useEffect(() => {
    if (bootstrap.data && !bootstrap.data.hasProfile) router.replace("/welcome");
  }, [bootstrap.data, router]);

  const deals = useMemo(() => board.data ?? [], [board.data]);
  const counts = useMemo(() => {
    const c: Record<BoardFilter, number> = {
      all: deals.length,
      intake: 0,
      parsing: 0,
      review: 0,
      complete: 0,
    };
    for (const d of deals) {
      if (d.status in c) c[d.status as BoardFilter] += 1;
    }
    return c;
  }, [deals]);

  const query = search.trim().toLowerCase();
  const matched = useMemo(() => {
    let rows = filter === "all" ? deals : deals.filter((d) => d.status === filter);
    if (query !== "") rows = rows.filter((d) => d.name.toLowerCase().includes(query));
    if (sort === "name") rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    // "activity" keeps server order; pinned deals float first either way
    // (stable partition - presentation, not truth).
    return [...rows.filter((d) => pinned.has(d.id)), ...rows.filter((d) => !pinned.has(d.id))];
  }, [deals, filter, query, sort, pinned]);

  const filterActive = filter !== "all" || sort !== "activity";

  if (mode === "wizard") {
    return (
      <AppShell breadcrumb="Deals">
        <main className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 md:py-6 lg:px-8">
          <NewDealWizard
            onCancel={() => setMode("board")}
            onDone={() => {
              setMode("board");
              void utils.deals.board.invalidate();
            }}
          />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumb="Deals">
      <main
        className={cn(
          "mx-auto max-w-[1400px] px-4 py-4 sm:px-6 md:py-6 lg:px-8",
          mode === "leaving" && "anim-board-out",
          mode === "board" && "anim-panel-in",
        )}
        onAnimationEnd={(e) => {
          if (e.animationName === "board-out") setMode("wizard");
        }}
      >
        {/* ── Toolbar: search · filter/sort · view · New deal ── */}
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

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Filter and sort deals"
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border transition-colors duration-150 hover:bg-accent data-[state=open]:bg-accent max-md:hidden",
                filterActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <ListFilter aria-hidden="true" className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-56 rounded-xl p-1.5">
              <DropdownMenuLabel className="text-muted-foreground text-[13px] font-normal">
                Filter by status
              </DropdownMenuLabel>
              {(["all", "review", "parsing", "intake", "complete"] as const).map((key) => (
                <DropdownMenuItem
                  key={key}
                  onSelect={() => setFilter(key)}
                  className="rounded-lg text-[13px]"
                >
                  <span className="flex-1">{key === "all" ? "All" : STATUS_LABEL[key]}</span>
                  <span className="text-muted-foreground tabular-nums">{counts[key]}</span>
                  {filter === key ? <Check aria-hidden="true" className="size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-[13px] font-normal">
                Sort by
              </DropdownMenuLabel>
              {(
                [
                  { key: "activity", label: "Activity" },
                  { key: "name", label: "Name" },
                ] as const
              ).map((s) => (
                <DropdownMenuItem
                  key={s.key}
                  onSelect={() => setSort(s.key)}
                  className="rounded-lg text-[13px]"
                >
                  <span className="flex-1">{s.label}</span>
                  {sort === s.key ? <Check aria-hidden="true" className="size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Segmented
            ariaLabel="Board view"
            size="md"
            value={view}
            onChange={pickView}
            options={[
              {
                value: "grid",
                ariaLabel: "Grid view",
                label: <LayoutGrid aria-hidden="true" className="size-4" />,
              },
              {
                value: "list",
                ariaLabel: "List view",
                label: <ListIcon aria-hidden="true" className="size-4" />,
              },
            ]}
            className="shrink-0 max-md:hidden"
          />

          {/* Add New ▾ - the reference's split-CTA in OUR teal (Pratik
              2026-07-30: brand colour on the primary create action). Menu
              items map the create-actions the product will grow into. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Add new"
              className="bg-primary hover:bg-primary/90 flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-white transition-colors duration-150 sm:px-4"
            >
              <span className="max-sm:sr-only">Add New</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-80" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-56 rounded-xl p-1.5">
              <DropdownMenuItem
                className="rounded-lg text-[13px]"
                // Deferred a tick so Radix's focus-return on menu close lands
                // before the board starts its exit animation.
                onSelect={() => setTimeout(openWizard, 0)}
              >
                New deal
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg text-[13px]">
                <Link href="/settings/members">Invite team member</Link>
              </DropdownMenuItem>
              <DropdownMenuItem disabled className="rounded-lg text-[13px]">
                <span className="flex-1">New integration</span>
                <Pill tone="accent">Soon</Pill>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ── Phone: counts as filter (ui-14-6, unchanged) ── */}
        <Segmented
          ariaLabel="Filter deals"
          size="auto"
          value={filter === "all" || filter === "review" || filter === "complete" ? filter : "all"}
          onChange={(v) => setFilter(v)}
          options={(
            [
              { key: "all", label: "All" },
              { key: "review", label: "Review" },
              { key: "complete", label: "Complete" },
            ] as const
          ).map((tab) => ({
            value: tab.key,
            label: (
              <>
                {tab.label}
                <span className="ml-1.5 tabular-nums opacity-70">{counts[tab.key]}</span>
              </>
            ),
          }))}
          className="border-border/60 mt-3 inline-flex md:hidden"
        />

        {/* ── Desktop: rail + deals ── */}
        <div className="mt-6 gap-8 max-md:hidden xl:grid xl:grid-cols-[300px_1fr]">
          <div className="space-y-6 max-xl:hidden">
            <UsageRail />
            <ActivityRail />
          </div>

          <section>
            <SectionHeader>Deals</SectionHeader>
            {board.isLoading ? (
              <DealsSkeleton view={view} />
            ) : matched.length === 0 ? (
              <FirstRun hasAnyDeal={deals.length > 0} onNew={openWizard} />
            ) : view === "grid" ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {matched.map((d) => (
                  <DealGridCard
                    key={d.id}
                    deal={d}
                    pinned={pinned.has(d.id)}
                    onTogglePin={() => togglePin(d.id)}
                  />
                ))}
              </div>
            ) : (
              <List>
                {matched.map((d) => (
                  <DealListRow
                    key={d.id}
                    deal={d}
                    pinned={pinned.has(d.id)}
                    onTogglePin={() => togglePin(d.id)}
                  />
                ))}
              </List>
            )}
          </section>
        </div>

        {/* ── Phone: ONE list, sticky group headers, urgent first ── */}
        <div className="mt-4 md:hidden">
          {board.isLoading ? (
            <div className="space-y-1.5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[104px] rounded-xl" />
              ))}
            </div>
          ) : matched.length === 0 ? (
            <FirstRun hasAnyDeal={deals.length > 0} onNew={openWizard} />
          ) : (
            MOBILE_GROUPS.map((group) => {
              const rows = matched.filter((d) => d.status === group.status);
              if (rows.length === 0) return null;
              return (
                <section key={group.status}>
                  <h2 className="bg-background/95 text-muted-foreground sticky top-14 z-10 py-2 text-[11px] font-semibold tracking-wider uppercase backdrop-blur">
                    {group.label}
                    <span className="text-foreground/70 ml-1.5 tabular-nums">{rows.length}</span>
                  </h2>
                  <ul className="space-y-1.5">
                    {rows.map((d) => (
                      <DealRow key={d.id} deal={d} />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
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
  createdAt: string;
  updatedAt: string;
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

/** Status dot colour - one dot per row, the only per-row colour. */
const STATUS_DOT: Record<string, string> = {
  intake: "bg-muted-foreground/50",
  parsing: "bg-severity-warning",
  review: "bg-primary",
  complete: "bg-primary/40",
};

/** Human relative time - a list-scanning affordance, not a fact record. */
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

/**
 * Document-completeness ring (the reference's deployment-status ring):
 * geometry from two real counts, a check glyph at completion.
 */
function DocRing({ have, need }: { have: number; need: number }) {
  const done = need > 0 && have >= need;
  const r = 8;
  const c = 2 * Math.PI * r;
  const frac = need === 0 ? 0 : have / need;
  return (
    <span
      className="relative inline-flex size-6 shrink-0 items-center justify-center"
      title={`${have}/${need} document groups present`}
    >
      <svg viewBox="0 0 20 20" className="size-6 -rotate-90">
        <circle cx="10" cy="10" r={r} fill="none" strokeWidth="2" className="stroke-border" />
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className="stroke-primary transition-[stroke-dashoffset] duration-250"
        />
      </svg>
      {done ? (
        <Check aria-hidden="true" className="absolute size-3 text-primary" strokeWidth={3} />
      ) : null}
    </span>
  );
}

/** The desktop grid card - the reference's project-card anatomy, our facts. */
function DealGridCard({
  deal,
  pinned,
  onTogglePin,
}: {
  deal: BoardDeal;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const { have, need } = docProgress(deal);
  return (
    <Link
      href={`/deals/${deal.id}/workspace`}
      className="glass-card hover:border-primary/40 group block rounded-lg p-4 transition-[border-color] duration-150"
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            STATUS_DOT[deal.status] ?? "bg-border",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[15px] leading-tight font-semibold">
            {pinned ? (
              <Star aria-label="Pinned" className="fill-primary text-primary size-3 shrink-0" />
            ) : null}
            {deal.name}
          </p>
          <p className="text-muted-foreground mt-0.5 text-[13px]">
            {deal.type.replaceAll("_", " ")}
          </p>
        </div>
        <QuickOverview dealId={deal.id} dealName={deal.name} />
        <DealMenu deal={deal} pinned={pinned} onTogglePin={onTogglePin} />
        {deal.dscr ? (
          <span
            className="shrink-0 text-[15px] font-semibold tabular-nums"
            title={`DSCR ${deal.dscr.period}`}
          >
            {formatRatio(deal.dscr.mantissa, deal.dscr.scale)}×
          </span>
        ) : (
          <DocRing have={have} need={need} />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Pill>
          <FileText aria-hidden="true" className="size-3" />
          <span className="tabular-nums">
            {have}/{need}
          </span>{" "}
          docs
        </Pill>
        {deal.openIssues > 0 && (
          <Pill tone="warn">
            <PillDot className="bg-severity-warning" />
            <span className="tabular-nums">{deal.openIssues}</span>{" "}
            {deal.openIssues === 1 ? "issue" : "issues"}
          </Pill>
        )}
        <Pill>{STATUS_LABEL[deal.status] ?? deal.status}</Pill>
      </div>

      <p className="text-muted-foreground mt-3 text-[11px]">
        Updated {relativeTime(deal.updatedAt)}
      </p>
    </Link>
  );
}

/** List view: one surface, hairline rows (the reference's list toggle). */
function DealListRow({
  deal,
  pinned,
  onTogglePin,
}: {
  deal: BoardDeal;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const { have, need } = docProgress(deal);
  return (
    <li>
      <Link
        href={`/deals/${deal.id}/workspace`}
        className="hover:bg-accent/40 group flex items-center gap-3 px-4 py-3 transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl"
      >
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[deal.status] ?? "bg-border")}
        />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[15px] font-medium">
          {pinned ? (
            <Star aria-label="Pinned" className="fill-primary text-primary size-3 shrink-0" />
          ) : null}
          {deal.name}
        </span>
        <span className="text-muted-foreground shrink-0 text-[13px] max-lg:hidden">
          {deal.type.replaceAll("_", " ")}
        </span>
        <Pill className="shrink-0">
          <span className="tabular-nums">
            {have}/{need}
          </span>{" "}
          docs
        </Pill>
        {deal.openIssues > 0 ? (
          <Pill tone="warn" className="shrink-0">
            <span className="tabular-nums">{deal.openIssues}</span>{" "}
            {deal.openIssues === 1 ? "issue" : "issues"}
          </Pill>
        ) : null}
        {deal.dscr ? (
          <span className="w-14 shrink-0 text-right text-[15px] font-semibold tabular-nums">
            {formatRatio(deal.dscr.mantissa, deal.dscr.scale)}×
          </span>
        ) : (
          <span className="w-14 shrink-0" />
        )}
        <span className="text-muted-foreground w-16 shrink-0 text-right text-[11px]">
          {relativeTime(deal.updatedAt)}
        </span>
        <QuickOverview dealId={deal.id} dealName={deal.name} />
        <DealMenu deal={deal} pinned={pinned} onTogglePin={onTogglePin} />
      </Link>
    </li>
  );
}

/**
 * One-click overview jump, revealed on row/card hover - the card's own
 * click opens the workspace, so both landings are a single click
 * (Pratik: "both options"). Lives INSIDE the row <Link>: preventDefault
 * keeps the card from also navigating.
 */
function QuickOverview({ dealId, dealName }: { dealId: string; dealName: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={`Open overview for ${dealName}`}
      title="Open overview"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        router.push(`/deals/${dealId}/overview`);
      }}
      className="hover:bg-accent flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity duration-150 group-hover:opacity-100"
    >
      <LayoutDashboard aria-hidden="true" className="text-muted-foreground size-4" />
    </button>
  );
}

/**
 * The per-deal overflow menu (Pratik queue: pin/delete). Lives INSIDE the
 * row <Link>, so it stops propagation - opening the menu must not navigate.
 * Delete is staged (no backend removes a deal yet) and says so.
 */
function DealMenu({
  deal,
  pinned,
  onTogglePin,
}: {
  deal: BoardDeal;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`actions for ${deal.name}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className="hover:bg-accent data-[state=open]:bg-accent flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity duration-150 group-hover:opacity-100 data-[state=open]:opacity-100"
      >
        <MoreHorizontal aria-hidden="true" className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-44 rounded-xl p-1.5">
        {/* Both landings, always one menu away (Pratik: overview dashboard
            or straight to the workspace - the card itself opens workspace). */}
        <DropdownMenuItem asChild className="rounded-lg text-[13px]">
          <Link href={`/deals/${deal.id}/overview`}>
            <LayoutDashboard />
            <span>Open overview</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-lg text-[13px]">
          <Link href={`/deals/${deal.id}/workspace`}>
            <Table2 />
            <span>Open workspace</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="rounded-lg text-[13px]" onSelect={() => onTogglePin()}>
          <Star className={cn(pinned && "fill-primary text-primary")} />
          <span>{pinned ? "Unpin deal" : "Pin deal"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="rounded-lg text-[13px]">
          <span className="flex-1">Delete deal</span>
          <Pill tone="accent">Soon</Pill>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Usage rail - real spend per deal from pipeline.costs (server-aggregated;
 * the over-envelope tint is the server's flag, never a client threshold).
 */
function UsageRail() {
  const costs = trpc.pipeline.costs.useQuery(undefined, { staleTime: 60_000 });
  const [expanded, setExpanded] = useState(false);
  const rows = (costs.data ?? []).slice(0, expanded ? 10 : 4);
  const hasMore = (costs.data?.length ?? 0) > 4;
  return (
    <section>
      <SectionHeader>Usage</SectionHeader>
      <div className="glass-card relative rounded-lg pb-1">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-medium">Extraction spend</span>
          <Link
            href="/costs"
            className="text-muted-foreground hover:text-foreground text-[13px] transition-colors duration-150"
          >
            All usage →
          </Link>
        </div>
        {costs.isLoading ? (
          <SkeletonLines className="px-4 pb-4" />
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground px-4 pb-4 text-[13px]">
            No extraction runs yet - spend appears once the pipeline processes documents.
          </p>
        ) : (
          <>
            <ul>
              {rows.map((r, i) => (
                <li
                  key={r.dealId}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-4 py-2",
                    i % 2 === 0 && "bg-accent/30",
                  )}
                >
                  <SpendRing spentMicro={r.totalMicroUsd} envelopeMicro={r.envelopeMicroUsd} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{r.dealName}</span>
                  <span
                    className={cn(
                      "shrink-0 text-[13px] font-medium tabular-nums",
                      r.overEnvelope && "text-severity-warning",
                    )}
                  >
                    {formatMicroUsd(r.totalMicroUsd)}
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      / {formatMicroUsd(r.envelopeMicroUsd)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {hasMore ? (
              <button
                type="button"
                aria-label={expanded ? "Show fewer deals" : "Show more deals"}
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
                className="border-border bg-popover hover:bg-accent absolute -bottom-3.5 left-1/2 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border transition-colors duration-150"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "text-muted-foreground size-4 transition-transform duration-150",
                    expanded && "rotate-180",
                  )}
                />
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Per-deal envelope ring - the reference's usage-meter ring. Both numbers
 * come from the server; the arc is presentation geometry only.
 */
function SpendRing({ spentMicro, envelopeMicro }: { spentMicro: string; envelopeMicro: string }) {
  const spent = Number(spentMicro);
  const cap = Number(envelopeMicro);
  const frac = cap > 0 ? Math.min(1, spent / cap) : 0;
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2" className="stroke-border" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
        className={frac >= 1 ? "stroke-severity-warning" : "stroke-primary"}
      />
    </svg>
  );
}

/**
 * Recent activity - the org audit trail, feed-styled (the reference's
 * Recent Previews slot). audit.list is admin-gated today; the section
 * renders nothing for roles the policy excludes rather than erroring.
 */
function ActivityRail() {
  const activity = trpc.audit.list.useQuery({ limit: 6 }, { retry: false, staleTime: 30_000 });
  if (activity.error) return null;
  return (
    <section>
      <SectionHeader>Recent activity</SectionHeader>
      <div className="glass-card rounded-lg px-4 py-1">
        {activity.isLoading ? (
          <SkeletonLines className="py-3" />
        ) : (activity.data?.entries.length ?? 0) === 0 ? (
          <p className="text-muted-foreground py-3 text-[13px]">
            Nothing yet - changes to deals, facts, and members land here.
          </p>
        ) : (
          <ul className="divide-border/70 divide-y">
            {activity.data?.entries.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  <span className="text-muted-foreground">{e.action.replaceAll("_", " ")}</span>{" "}
                  <span className="font-medium">{e.tableName.replaceAll("_", " ")}</span>
                </span>
                <span className="text-muted-foreground shrink-0 text-[11px]">
                  {relativeTime(e.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-border/70 border-t py-2">
          <Link
            href="/audit"
            className="text-muted-foreground hover:text-foreground text-[13px] transition-colors duration-150"
          >
            Open audit log →
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Skeletons mirror the loaded anatomy (02 §3.14) - never fake zeros. */
function DealsSkeleton({ view }: { view: BoardView }) {
  if (view === "list") {
    return (
      <div className="glass-card divide-border/70 divide-y rounded-lg">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="glass-card rounded-lg p-4">
          <div className="flex items-start gap-2.5">
            <Skeleton className="mt-1 size-2 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="size-6 rounded-full" />
          </div>
          <div className="mt-3 flex gap-1.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The phone row (craft pass ui-16) - unchanged anatomy. */
function DealRow({ deal }: { deal: BoardDeal }) {
  const { have, need } = docProgress(deal);
  return (
    <li>
      <Link
        href={`/deals/${deal.id}/workspace`}
        className="group border-border/60 bg-card/50 hover:border-primary/40 hover:bg-card active:bg-accent/60 block rounded-xl border p-3 transition-[background-color,border-color] duration-150"
      >
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[deal.status] ?? "bg-border")}
          />
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{deal.name}</span>
          {deal.dscr && (
            <span className="text-foreground shrink-0 text-[15px] font-semibold tabular-nums">
              {formatRatio(deal.dscr.mantissa, deal.dscr.scale)}×
            </span>
          )}
          <ChevronRight
            aria-hidden="true"
            className="text-muted-foreground/40 group-hover:text-muted-foreground size-4 shrink-0 transition-colors duration-150"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-4">
          <Pill>{deal.type.replaceAll("_", " ")}</Pill>
          <Pill>
            <FileText aria-hidden="true" className="size-3" />
            <span className="tabular-nums">
              {have}/{need}
            </span>{" "}
            docs
          </Pill>
          {deal.openIssues > 0 && (
            <Pill tone="warn">
              <PillDot className="bg-severity-warning" />
              <span className="tabular-nums">{deal.openIssues}</span>{" "}
              {deal.openIssues === 1 ? "issue" : "issues"}
            </Pill>
          )}
        </div>

        <p className="text-muted-foreground mt-2 pl-4 text-[11px]">
          Updated {relativeTime(deal.updatedAt)}
        </p>
      </Link>
    </li>
  );
}

/** ONE panel, not four dashed boxes - reference empty-state anatomy. */
function FirstRun({ hasAnyDeal, onNew }: { hasAnyDeal: boolean; onNew: () => void }) {
  if (hasAnyDeal) {
    return (
      <p className="text-muted-foreground py-8 text-center text-[13px]">
        No deals match that filter.
      </p>
    );
  }
  return (
    <div className="glass-card flex flex-col items-center rounded-xl px-6 py-12 text-center">
      <span className="border-border bg-popover flex size-10 items-center justify-center rounded-[10px] border">
        <FileText aria-hidden="true" className="text-muted-foreground size-4" />
      </span>
      <p className="mt-3 text-[15px] font-semibold">No deals yet</p>
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
