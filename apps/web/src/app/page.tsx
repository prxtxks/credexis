"use client";

/**
 * Deal dashboard (M8.7, Blueprint §8.2): pipeline board — Intake →
 * Parsing → Review → Complete — with a doc-completeness checklist per
 * deal type, DSCR at a glance (rendered from engine strings; thresholds
 * for the traffic light come from the policy pack in the workspace), and
 * the new-deal wizard. V1 visual language (ui-2): stat tiles, glass deal
 * cards with hover lift, staggered reveals.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, Briefcase, CheckCircle2, Plus, X } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { checklistFor } from "@/lib/doc-checklist";
import { formatRatio } from "@/components/workspace/metrics-strip";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const COLUMNS = [
  { status: "intake", label: "Intake" },
  { status: "parsing", label: "Parsing" },
  { status: "review", label: "Review" },
  { status: "complete", label: "Complete" },
] as const;

const ENTITY_KINDS = ["applicant", "target", "guarantor", "spouse", "epc", "oc"] as const;
const DEAL_TYPES = ["business_acquisition", "working_capital", "real_estate", "refinance"] as const;

const fadeInUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

function NewDealWizard({ onDone }: { onDone: (dealId: string) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof DEAL_TYPES)[number]>("business_acquisition");
  const [entities, setEntities] = useState<{ name: string; kind: (typeof ENTITY_KINDS)[number] }[]>(
    [{ name: "", kind: "applicant" }],
  );
  const create = trpc.deals.create.useMutation({ onSuccess: (r) => onDone(r.dealId) });

  return (
    <div className="glass-card rounded-2xl glow-sm space-y-4 p-6 text-sm">
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
          <select
            id="deal-type"
            value={type}
            onChange={(e) => setType(e.target.value as (typeof DEAL_TYPES)[number])}
            className="border-input h-9 w-full rounded-xl border bg-background/50 px-3 text-sm"
          >
            {DEAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
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
            <select
              value={e.kind}
              onChange={(ev) =>
                setEntities(
                  entities.map((x, j) =>
                    j === i ? { ...x, kind: ev.target.value as (typeof ENTITY_KINDS)[number] } : x,
                  ),
                )
              }
              className="border-input h-9 rounded-xl border bg-background/50 px-3 text-sm"
            >
              {ENTITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
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

export default function DashboardPage() {
  const router = useRouter();
  const board = trpc.deals.board.useQuery(undefined, { refetchInterval: 15_000 });
  const [showWizard, setShowWizard] = useState(false);
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
  const reviewCount = deals.filter((d) => d.status === "review").length;
  const completeCount = deals.filter((d) => d.status === "complete").length;

  const stats = [
    { label: "Total deals", value: deals.length, icon: Briefcase, tint: "text-primary" },
    { label: "In review", value: reviewCount, icon: Activity, tint: "text-severity-warning" },
    { label: "Complete", value: completeCount, icon: CheckCircle2, tint: "text-primary" },
  ];

  return (
    <AppShell breadcrumb="SBA 7(a) Underwriting">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Stat tiles */}
        <motion.div
          className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3"
          initial="hidden"
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
        >
          {stats.map((s) => (
            <motion.div
              key={s.label}
              variants={fadeInUp}
              transition={{ duration: 0.4 }}
              className="glass-card flex items-center gap-4 rounded-xl p-5"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                <s.icon className={`h-5 w-5 ${s.tint}`} />
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Section header */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Deal pipeline</h1>
            <p className="text-sm text-muted-foreground">
              Intake through complete — documents in, pro-forma out.
            </p>
          </div>
          <Button onClick={() => setShowWizard((v) => !v)} className="px-5">
            {showWizard ? (
              <>
                <X className="mr-1.5 h-4 w-4" />
                Close
              </>
            ) : (
              <>
                <Plus className="mr-1.5 h-4 w-4" />
                New deal
              </>
            )}
          </Button>
        </div>

        {showWizard && (
          <div className="mb-8 max-w-2xl">
            <NewDealWizard
              onDone={() => {
                setShowWizard(false);
                void utils.deals.board.invalidate();
              }}
            />
          </div>
        )}

        {/* Pipeline board */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const colDeals = deals.filter((d) => d.status === col.status);
            return (
              <section key={col.status}>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {col.label} ({colDeals.length})
                </h2>
                <motion.div
                  className="space-y-3"
                  initial="hidden"
                  animate="visible"
                  variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
                >
                  {colDeals.map((d) => {
                    const checklist = checklistFor(d.type);
                    const have = checklist.filter((c) =>
                      c.formFamilies.some((f) => d.formFamilies.includes(f)),
                    );
                    return (
                      <motion.div key={d.id} variants={fadeInUp} transition={{ duration: 0.4 }}>
                        <Link href={`/deals/${d.id}/workspace`} className="group block">
                          <div className="glass-card rounded-xl p-4 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg">
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-semibold leading-tight transition-colors group-hover:text-primary">
                                {d.name}
                              </span>
                              {d.dscr && (
                                <span
                                  className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-xs font-semibold tabular-nums"
                                  title={`DSCR ${d.dscr.period}`}
                                >
                                  {formatRatio(d.dscr.mantissa, d.dscr.scale)}×
                                </span>
                              )}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <Badge
                                variant="secondary"
                                className="rounded-full px-2.5 text-xs font-normal"
                              >
                                {d.type.replaceAll("_", " ")}
                              </Badge>
                            </div>
                            <div className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">
                              docs {have.length}/{checklist.length}
                              <span className="ml-2 inline-flex gap-0.5 align-middle">
                                {checklist.map((c) => (
                                  <span
                                    key={c.label}
                                    title={c.label}
                                    className={`inline-block h-1.5 w-3 rounded-sm ${
                                      c.formFamilies.some((f) => d.formFamilies.includes(f))
                                        ? "bg-primary"
                                        : "bg-border"
                                    }`}
                                  />
                                ))}
                              </span>
                            </div>
                          </div>
                        </Link>
                      </motion.div>
                    );
                  })}
                  {colDeals.length === 0 && (
                    <div className="glass-card rounded-xl border-dashed p-4 text-center text-xs text-muted-foreground">
                      —
                    </div>
                  )}
                </motion.div>
              </section>
            );
          })}
        </div>
      </main>
    </AppShell>
  );
}
