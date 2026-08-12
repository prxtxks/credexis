"use client";

/**
 * Pro-Forma tab (M15): the banker's forecast, computed by the engine from
 * accepted facts + explicit assumptions. The client RENDERS server truth
 * and edits assumption inputs - it never computes a number (Iron Law #3).
 * Assumption edits preview live (uncommitted compute round-trips) and
 * persist only on Save, audited like every underwriting decision.
 */

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { formatCents, formatRatio } from "@/lib/money-display";
import { Button } from "@/components/ui/button";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Treatment = "ratio" | "fixed" | "excluded";

interface LineSource {
  valueCents: bigint;
  method: string;
  page: number | null;
  registryFieldId: string | null;
  docLabel: string | null;
}

const METHOD_LABEL: Record<string, string> = {
  extract_consensus: "consensus",
  extract_primary: "extracted",
  extract_vision: "vision",
  statement_suggested: "statement",
  human: "human input",
  override: "override",
  transcript: "IRS transcript",
};

/**
 * Composition disclosure (M21): the line label opens the printed source
 * lines behind the number - doc, page, method, amount. When several
 * printed lines roll into one category (Domain Ruling #1, e.g. payroll
 * taxes + unemployment tax), the underwriter sees exactly that, in
 * place, with no math done here (server sums; this renders).
 */
function LineLabel({ label, sources }: { label: string; sources: LineSource[] | undefined }) {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) {
    return <span>{label}</span>;
  }
  return (
    <span className="relative inline-block">
      <button
        type="button"
        className="decoration-border hover:decoration-foreground/60 cursor-help rounded-sm text-left underline decoration-dotted underline-offset-4"
        aria-label={`Show the ${sources.length} source line${sources.length === 1 ? "" : "s"} behind ${label}`}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {sources.length > 1 ? (
          <span className="bg-accent text-foreground/80 ml-1.5 rounded-full px-1.5 py-0.5 align-middle text-[10px] font-semibold tabular-nums">
            ×{sources.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <>
          <button
            aria-label="Close source breakdown"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="border-border bg-popover absolute top-full left-0 z-50 mt-1.5 w-80 rounded-xl border p-3 shadow-xl">
            <p className="text-muted-foreground pb-2 text-[11px] font-semibold tracking-wider uppercase">
              What built this number
            </p>
            <ul className="divide-border/60 divide-y">
              {sources.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                  <span className="text-muted-foreground min-w-0 truncate">
                    {s.docLabel ?? "document"}
                    {s.page !== null ? ` · p. ${s.page}` : ""}
                    {s.registryFieldId ? ` · ${s.registryFieldId}` : ""}
                    <span className="text-foreground/60">
                      {" "}
                      · {METHOD_LABEL[s.method] ?? s.method}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatCents(s.valueCents.toString())}</span>
                </li>
              ))}
            </ul>
            {sources.length > 1 ? (
              <p className="text-muted-foreground border-border/60 mt-1 border-t pt-2 text-[11px]">
                Several printed lines roll into this category; each stays verifiable at its source.
                The total is computed by the engine.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </span>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="glass-card text-muted-foreground flex h-full items-center justify-center rounded-xl px-8 text-center text-sm">
      {msg}
    </div>
  );
}

export function ProformaPanel({
  dealId,
  scenarioId,
}: {
  dealId: string;
  scenarioId: string | null;
}) {
  // Uncommitted assumption edits; undefined = use stored/default.
  const [growthDraft, setGrowthDraft] = useState<string[] | undefined>(undefined);
  const [basePeriodDraft, setBasePeriodDraft] = useState<string | undefined>(undefined);
  const [monthsDraft, setMonthsDraft] = useState<string | undefined>(undefined);
  const [treatmentDrafts, setTreatmentDrafts] = useState<Record<string, Treatment>>({});
  const [salaryDraft, setSalaryDraft] = useState<string | undefined>(undefined);

  const preview = {
    ...(basePeriodDraft !== undefined ? { basePeriodLabel: basePeriodDraft } : {}),
    ...(monthsDraft !== undefined && /^\d+$/.test(monthsDraft)
      ? { monthsCovered: Number(monthsDraft) }
      : {}),
    ...(growthDraft !== undefined && growthDraft.every((g) => /^-?\d+(\.\d+)?$/.test(g))
      ? { revenueGrowthBpsByYear: growthDraft.map((g) => Math.round(Number(g) * 100)) }
      : {}),
    ...(Object.keys(treatmentDrafts).length > 0 ? { lineTreatments: treatmentDrafts } : {}),
    ...(salaryDraft !== undefined && /^\d+$/.test(salaryDraft)
      ? { replacementSalaryCents: String(BigInt(salaryDraft) * 100n) }
      : {}),
  };

  const q = trpc.proforma.get.useQuery({
    dealId,
    scenarioId,
    ...(Object.keys(preview).length > 0 ? { preview } : {}),
  });
  const utils = trpc.useUtils();
  const save = trpc.proforma.save.useMutation({
    onSuccess: () => {
      toast.success("Assumptions saved");
      setGrowthDraft(undefined);
      setBasePeriodDraft(undefined);
      setMonthsDraft(undefined);
      setTreatmentDrafts({});
      setSalaryDraft(undefined);
      void utils.proforma.get.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) {
    return (
      <div className="glass-card h-full space-y-3 rounded-xl p-6">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  const d = q.data;
  if (!d) return null;
  if (d.state === "no_entity") {
    return <Empty msg="Add a target entity to this deal to project a pro-forma." />;
  }
  if (d.state === "no_accepted_facts") {
    return (
      <Empty
        msg={`No accepted facts for ${d.entityName} yet - accept extraction results in the review queue and the pro-forma anchors on them.`}
      />
    );
  }
  if (d.state === "base_period_gone") {
    return <Empty msg={`Base period ${d.basePeriodLabel} has no facts anymore.`} />;
  }

  const growth =
    growthDraft ?? d.assumptions.revenueGrowthBpsByYear.map((b) => (b / 100).toString());
  const years = d.projection.years;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto">
      {/* ── Assumptions strip ── */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              Base period
            </span>
            <FieldSelect
              ariaLabel="Pro-forma base period"
              value={basePeriodDraft ?? d.assumptions.basePeriodLabel}
              onChange={setBasePeriodDraft}
              options={d.periods.map((p) => ({ value: p, label: p }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              Months covered
            </span>
            <Input
              value={monthsDraft ?? String(d.assumptions.monthsCovered)}
              onChange={(e) => setMonthsDraft(e.target.value)}
              aria-label="Months covered by base period"
              className="h-8 w-20"
            />
          </label>
          {growth.map((g, i) => (
            <label key={i} className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                Y{i + 1} growth %
              </span>
              <Input
                value={g}
                onChange={(e) =>
                  setGrowthDraft(growth.map((x, j) => (j === i ? e.target.value : x)))
                }
                aria-label={`Year ${i + 1} revenue growth percent`}
                className="h-8 w-20"
              />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              Owner salary ($/yr)
            </span>
            <Input
              value={salaryDraft ?? String(BigInt(d.assumptions.replacementSalaryCents) / 100n)}
              onChange={(e) => setSalaryDraft(e.target.value)}
              aria-label="Replacement salary dollars per year"
              className="h-8 w-28"
            />
          </label>
          <Button
            size="sm"
            variant="brand"
            className="ml-auto"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                dealId,
                basePeriodLabel: basePeriodDraft ?? d.assumptions.basePeriodLabel,
                monthsCovered: Number(monthsDraft ?? d.assumptions.monthsCovered),
                revenueGrowthBpsByYear: growth.map((g) => Math.round(Number(g) * 100)),
                lineTreatments: {
                  ...d.assumptions.lineTreatments,
                  ...treatmentDrafts,
                } as Record<string, Treatment>,
                replacementSalaryCents:
                  salaryDraft !== undefined
                    ? String(BigInt(salaryDraft) * 100n)
                    : d.assumptions.replacementSalaryCents,
              })
            }
          >
            Save assumptions
          </Button>
        </div>
        <p className="text-muted-foreground mt-2 text-[11px]">
          Anchored on accepted facts for {d.entityName}
          {d.loanScenarioName
            ? ` - debt service from scenario "${d.loanScenarioName}"`
            : " - pick a loan scenario to add debt service and DSCR"}
          . Every projected number is base × assumption; the assumption record is the audit trail.
        </p>
      </div>

      {/* ── Projection grid ── */}
      <div className="glass-card flex-1 overflow-auto rounded-xl">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-border/70 text-muted-foreground border-b text-left text-[13px]">
              <th className="px-4 py-2.5 font-normal">Line</th>
              <th className="px-4 py-2.5 text-right font-normal">
                {d.projection.baseAnnualized.periodLabel}
              </th>
              {years.map((y) => (
                <th key={y.label} className="px-4 py-2.5 text-right font-normal">
                  {y.label}
                </th>
              ))}
              <th className="px-4 py-2.5 font-normal">Treatment</th>
            </tr>
          </thead>
          <tbody className="divide-border/70 divide-y">
            <Row
              label="Revenue"
              strong
              cells={[
                d.projection.baseAnnualized.revenueCents,
                ...years.map((y) => y.revenueCents),
              ]}
            />
            {d.base.lines
              .filter((l) => (treatmentDrafts[l.key] ?? l.treatment) !== "excluded")
              .map((line) => {
                const projected = years.map(
                  (y) => y.lines.find((x) => x.key === line.key)?.amountCents ?? 0n,
                );
                const annual =
                  d.projection.baseAnnualized.lines.find((x) => x.key === line.key)?.amountCents ??
                  0n;
                return (
                  <tr key={line.key} className="hover:bg-accent/30">
                    <td className="text-muted-foreground px-4 py-2">
                      <LineLabel
                        label={line.label}
                        sources={(line as { sources?: LineSource[] }).sources}
                      />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCents(annual.toString())}
                    </td>
                    {projected.map((v, i) => (
                      <td key={i} className="px-4 py-2 text-right tabular-nums">
                        {formatCents(v.toString())}
                      </td>
                    ))}
                    <td className="px-4 py-2">
                      <FieldSelect
                        ariaLabel={`Treatment for ${line.label}`}
                        value={treatmentDrafts[line.key] ?? line.treatment}
                        onChange={(v) =>
                          setTreatmentDrafts((t) => ({ ...t, [line.key]: v as Treatment }))
                        }
                        options={[
                          { value: "ratio", label: "% of revenue" },
                          { value: "fixed", label: "Fixed" },
                          { value: "excluded", label: "Excluded" },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            <Row
              label="Operating expenses"
              cells={[
                // Engine-computed (Iron Law #3) - the client never adds money.
                d.projection.baseAnnualized.operatingExpensesCents,
                ...years.map((y) => y.operatingExpensesCents),
              ]}
            />
            <Row label="NOI" strong cells={[null, ...years.map((y) => y.noiCents)]} />
            <Row label="CFADS" strong cells={[null, ...years.map((y) => y.cfadsCents)]} />
            <Row label="Debt service" cells={[null, ...years.map((y) => y.debtServiceCents)]} />
            <tr className="border-border/70 border-t-2">
              <td className="px-4 py-2.5 font-semibold">DSCR</td>
              <td className="px-4 py-2.5" />
              {years.map((y) => (
                <td
                  key={y.label}
                  className={cn(
                    "px-4 py-2.5 text-right font-semibold tabular-nums",
                    y.dscr === null
                      ? "text-muted-foreground"
                      : Number(y.dscr.mantissa) / 10 ** y.dscr.scale >= 1.25
                        ? "text-primary"
                        : "text-severity-warning",
                  )}
                >
                  {y.dscr === null
                    ? "-"
                    : `${formatRatio(y.dscr.mantissa.toString(), y.dscr.scale)}×`}
                </td>
              ))}
              <td className="px-4 py-2.5" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  label,
  cells,
  strong,
}: {
  label: string;
  cells: (bigint | null)[];
  strong?: boolean;
}) {
  return (
    <tr className={cn(strong && "font-semibold")}>
      <td className={cn("px-4 py-2", !strong && "text-muted-foreground")}>{label}</td>
      {cells.map((v, i) => (
        <td key={i} className="px-4 py-2 text-right tabular-nums">
          {v === null ? "" : formatCents(v.toString())}
        </td>
      ))}
      <td className="px-4 py-2" />
    </tr>
  );
}
