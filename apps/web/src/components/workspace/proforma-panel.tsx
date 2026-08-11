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
                    <td className="text-muted-foreground px-4 py-2">{line.label}</td>
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
                sumLines(d.projection.baseAnnualized.lines),
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

function sumLines(lines: { amountCents: bigint }[]): bigint {
  return lines.reduce((a, l) => a + l.amountCents, 0n);
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
