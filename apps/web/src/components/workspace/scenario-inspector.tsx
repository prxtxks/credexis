"use client";

/**
 * Loan scenario inspector (M8.6): structured inputs — amount, rate spec
 * (fixed / prime+spread with the current prime as an explicit input), term,
 * use of proceeds, equity injection, replacement salary — for multiple
 * scenarios. Saving recomputes server-side; the metrics strip and policy
 * chips re-render from fresh engine output (never client math).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { formatCents, parseDollarsInput } from "@/lib/money-display";

const USE_OF_PROCEEDS = ["business_acquisition", "working_capital", "equipment", "real_estate"];

interface Draft {
  name: string;
  amount: string;
  rateType: "fixed" | "prime_spread";
  bps: string;
  spreadBps: string;
  primeBps: string;
  termMonths: string;
  useOfProceeds: string[];
  equityInjection: string;
  totalProjectCost: string;
  replacementSalary: string;
}

const EMPTY: Draft = {
  name: "Scenario A",
  amount: "",
  rateType: "prime_spread",
  bps: "",
  spreadBps: "275",
  primeBps: "750",
  termMonths: "120",
  useOfProceeds: ["business_acquisition"],
  equityInjection: "",
  totalProjectCost: "",
  replacementSalary: "",
};

export function ScenarioInspector({
  dealId,
  selectedScenarioId,
  onSelectScenario,
}: {
  dealId: string;
  selectedScenarioId: string | null;
  onSelectScenario: (id: string | null) => void;
}) {
  const utils = trpc.useUtils();
  const scenarios = trpc.metrics.scenarios.list.useQuery({ dealId });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const invalidate = () => {
    void utils.metrics.invalidate();
    void utils.policy.invalidate();
    setDraft(null);
    setEditingId(null);
  };
  const create = trpc.metrics.scenarios.create.useMutation({
    onSuccess: (r) => {
      onSelectScenario(r.scenarioId);
      invalidate();
    },
  });
  const update = trpc.metrics.scenarios.update.useMutation({ onSuccess: invalidate });

  function submit() {
    if (!draft) return;
    const amountCents = parseDollarsInput(draft.amount);
    if (amountCents === null) return;
    const structure = {
      ...(draft.rateType === "prime_spread" && draft.primeBps
        ? { primeBps: Number(draft.primeBps) }
        : {}),
      ...(draft.useOfProceeds.length > 0 ? { useOfProceeds: draft.useOfProceeds } : {}),
      ...(parseDollarsInput(draft.equityInjection)
        ? { equityInjectionCents: parseDollarsInput(draft.equityInjection)! }
        : {}),
      ...(parseDollarsInput(draft.totalProjectCost)
        ? { totalProjectCostCents: parseDollarsInput(draft.totalProjectCost)! }
        : {}),
      ...(parseDollarsInput(draft.replacementSalary)
        ? { replacementSalaryCents: parseDollarsInput(draft.replacementSalary)! }
        : {}),
    };
    const rateSpec =
      draft.rateType === "fixed"
        ? { type: "fixed" as const, bps: Number(draft.bps) }
        : { type: "prime_spread" as const, spread_bps: Number(draft.spreadBps) };
    const payload = {
      name: draft.name,
      amountCents,
      rateSpec,
      termMonths: Number(draft.termMonths),
      structure,
    };
    if (editingId) update.mutate({ scenarioId: editingId, ...payload });
    else create.mutate({ dealId, ...payload });
  }

  const error = create.error ?? update.error;

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        {(scenarios.data ?? []).map((s) => (
          <div
            key={s.id}
            className={`flex items-center justify-between rounded border border-line p-2 dark:border-line-dark ${
              s.id === selectedScenarioId ? "bg-surface-muted dark:bg-surface-dark-muted" : ""
            }`}
          >
            <button className="text-left" onClick={() => onSelectScenario(s.id)}>
              <span className="font-semibold">{s.name}</span>
              <span className="ml-2 text-xs text-ink-muted dark:text-ink-dark-muted">
                {formatCents(s.amountCents)} · {s.termMonths}mo
              </span>
            </button>
            <button
              className="text-xs text-primary underline dark:text-primary-dark"
              onClick={() => {
                setEditingId(s.id);
                const st = (s.structure ?? {}) as Record<string, unknown>;
                setDraft({
                  name: s.name,
                  amount: formatCents(s.amountCents).replace("$", ""),
                  rateType: (s.rateSpec.type as Draft["rateType"]) ?? "prime_spread",
                  bps: String(s.rateSpec.bps ?? ""),
                  spreadBps: String(s.rateSpec.spread_bps ?? ""),
                  primeBps: String(st["primeBps"] ?? ""),
                  termMonths: String(s.termMonths),
                  useOfProceeds: Array.isArray(st["useOfProceeds"])
                    ? (st["useOfProceeds"] as string[])
                    : [],
                  equityInjection: st["equityInjectionCents"]
                    ? formatCents(String(st["equityInjectionCents"])).replace("$", "")
                    : "",
                  totalProjectCost: st["totalProjectCostCents"]
                    ? formatCents(String(st["totalProjectCostCents"])).replace("$", "")
                    : "",
                  replacementSalary: st["replacementSalaryCents"]
                    ? formatCents(String(st["replacementSalaryCents"])).replace("$", "")
                    : "",
                });
              }}
            >
              edit
            </button>
          </div>
        ))}
        {!draft && (
          <button
            onClick={() => setDraft(EMPTY)}
            className="w-full rounded border border-dashed border-line p-2 text-xs text-ink-muted dark:border-line-dark dark:text-ink-dark-muted"
          >
            + New scenario
          </button>
        )}
      </div>

      {draft && (
        <div className="space-y-2 border-t border-line pt-2 dark:border-line-dark">
          <label className="block text-xs font-semibold">
            Name
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="mt-0.5 w-full rounded border border-line px-2 py-1 font-normal dark:border-line-dark dark:bg-surface-dark-muted"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-semibold">
              Loan amount ($)
              <input
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                placeholder="350,000.00"
                className="mt-0.5 w-full rounded border border-line px-2 py-1 font-normal dark:border-line-dark dark:bg-surface-dark-muted"
              />
            </label>
            <label className="block text-xs font-semibold">
              Term (months)
              <input
                value={draft.termMonths}
                onChange={(e) => setDraft({ ...draft, termMonths: e.target.value })}
                inputMode="numeric"
                className="mt-0.5 w-full rounded border border-line px-2 py-1 font-normal dark:border-line-dark dark:bg-surface-dark-muted"
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs font-semibold">
              Rate
              <select
                value={draft.rateType}
                onChange={(e) =>
                  setDraft({ ...draft, rateType: e.target.value as Draft["rateType"] })
                }
                className="mt-0.5 w-full rounded border border-line px-2 py-1 font-normal dark:border-line-dark dark:bg-surface-dark-muted"
              >
                <option value="prime_spread">Prime + spread</option>
                <option value="fixed">Fixed</option>
              </select>
            </label>
            {draft.rateType === "fixed" ? (
              <label className="block text-xs font-semibold">
                Rate (bps)
                <input
                  value={draft.bps}
                  onChange={(e) => setDraft({ ...draft, bps: e.target.value })}
                  inputMode="numeric"
                  placeholder="1050"
                  className="mt-0.5 w-full rounded border border-line px-2 py-1 font-normal dark:border-line-dark dark:bg-surface-dark-muted"
                />
              </label>
            ) : (
              <>
                <label className="block text-xs font-semibold">
                  Spread (bps)
                  <input
                    value={draft.spreadBps}
                    onChange={(e) => setDraft({ ...draft, spreadBps: e.target.value })}
                    inputMode="numeric"
                    className="mt-0.5 w-full rounded border border-line px-2 py-1 font-normal dark:border-line-dark dark:bg-surface-dark-muted"
                  />
                </label>
                <label className="block text-xs font-semibold">
                  Prime (bps)
                  <input
                    value={draft.primeBps}
                    onChange={(e) => setDraft({ ...draft, primeBps: e.target.value })}
                    inputMode="numeric"
                    className="mt-0.5 w-full rounded border border-line px-2 py-1 font-normal dark:border-line-dark dark:bg-surface-dark-muted"
                  />
                </label>
              </>
            )}
          </div>
          <fieldset className="text-xs">
            <legend className="font-semibold">Use of proceeds</legend>
            <div className="mt-0.5 flex flex-wrap gap-2">
              {USE_OF_PROCEEDS.map((u) => (
                <label key={u} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={draft.useOfProceeds.includes(u)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        useOfProceeds: e.target.checked
                          ? [...draft.useOfProceeds, u]
                          : draft.useOfProceeds.filter((x) => x !== u),
                      })
                    }
                  />
                  {u.replaceAll("_", " ")}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-semibold">
              Equity injection ($)
              <input
                value={draft.equityInjection}
                onChange={(e) => setDraft({ ...draft, equityInjection: e.target.value })}
                className="mt-0.5 w-full rounded border border-line px-2 py-1 font-normal dark:border-line-dark dark:bg-surface-dark-muted"
              />
            </label>
            <label className="block text-xs font-semibold">
              Total project cost ($)
              <input
                value={draft.totalProjectCost}
                onChange={(e) => setDraft({ ...draft, totalProjectCost: e.target.value })}
                className="mt-0.5 w-full rounded border border-line px-2 py-1 font-normal dark:border-line-dark dark:bg-surface-dark-muted"
              />
            </label>
          </div>
          <label className="block text-xs font-semibold">
            Replacement salary ($ / yr)
            <input
              value={draft.replacementSalary}
              onChange={(e) => setDraft({ ...draft, replacementSalary: e.target.value })}
              className="mt-0.5 w-full rounded border border-line px-2 py-1 font-normal dark:border-line-dark dark:bg-surface-dark-muted"
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={create.isPending || update.isPending}
              className="rounded bg-primary px-3 py-1 text-primary-foreground dark:bg-primary-dark"
            >
              {editingId ? "Save scenario" : "Create scenario"}
            </button>
            <button
              onClick={() => {
                setDraft(null);
                setEditingId(null);
              }}
              className="rounded border border-line px-3 py-1 dark:border-line-dark"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-severity-critical">{error.message}</p>}
        </div>
      )}
    </div>
  );
}
