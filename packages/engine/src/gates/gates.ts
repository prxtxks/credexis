/**
 * G1–G6 (M6.1, Blueprint §4.5) — deterministic, run after every pipeline
 * run and every override. V1 computed checks and displayed nothing
 * (post-mortem trap 9); here every violation is an issue object and G1–G5
 * failures BLOCK auto-accept of the implicated facts.
 *
 * | Gate | Check                                        | Tolerance            |
 * | G1   | Subtotals = Σ children (taxonomy siblings)   | ±$1/level            |
 * | G2   | Assets = Liabilities + Equity per period     | ±$2                  |
 * | G3   | Tax NI vs P&L NI, same entity+period         | flag > max($500, 1%) |
 * | G4   | Registry relations + cross-form flows        | per relation (exact) |
 * | G5   | Parsed vs IRS transcript lines               | exact; fraud signal  |
 * | G6   | YoY swings beyond band                       | flag only            |
 */

import type { GateConfig, GateFact, GateIssue, GateRunResult, TaxonomyNodeRef } from "./types.js";

const abs = (v: bigint) => (v < 0n ? -v : v);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

type Group = Map<string, GateFact[]>; // key: entityId|periodLabel

function groupByEntityPeriod(facts: GateFact[]): Group {
  const g: Group = new Map();
  for (const f of facts) {
    if (f.status === "rejected") continue;
    const key = `${f.entityId}|${f.periodLabel}`;
    const list = g.get(key) ?? [];
    list.push(f);
    g.set(key, list);
  }
  return g;
}

/** Latest-wins per identity: overrides supersede consensus/vendor values. */
const METHOD_RANK: Record<GateFact["method"], number> = {
  vendor: 0,
  llm: 0,
  consensus: 1,
  transcript: 2,
  human: 3,
  override: 4,
};

function byNode(facts: GateFact[]): Map<string, GateFact> {
  const m = new Map<string, GateFact>();
  for (const f of facts) {
    if (f.taxonomyNodeKey === null) continue;
    const cur = m.get(f.taxonomyNodeKey);
    if (!cur || METHOD_RANK[f.method] > METHOD_RANK[cur.method]) m.set(f.taxonomyNodeKey, f);
  }
  return m;
}

function byRegistryField(facts: GateFact[]): Map<string, GateFact[]> {
  const m = new Map<string, GateFact[]>();
  for (const f of facts) {
    if (f.registryFieldId === null) continue;
    const list = m.get(f.registryFieldId) ?? [];
    list.push(f);
    m.set(f.registryFieldId, list);
  }
  return m;
}

/** Highest-authority fact per field (G4 math; G5 needs the full list). */
function bestByRegistryField(facts: GateFact[]): Map<string, GateFact> {
  const m = new Map<string, GateFact>();
  for (const f of facts) {
    if (f.registryFieldId === null) continue;
    const cur = m.get(f.registryFieldId);
    if (!cur || METHOD_RANK[f.method] > METHOD_RANK[cur.method]) m.set(f.registryFieldId, f);
  }
  return m;
}

/* ── G1: taxonomy subtotal arithmetic ─────────────────────────────────── */

export function runG1(facts: GateFact[], taxonomy: TaxonomyNodeRef[]): GateIssue[] {
  const issues: GateIssue[] = [];
  const childrenOf = new Map<string, string[]>();
  for (const n of taxonomy) {
    if (n.parentKey) {
      const list = childrenOf.get(n.parentKey) ?? [];
      list.push(n.key);
      childrenOf.set(n.parentKey, list);
    }
  }

  for (const [key, group] of groupByEntityPeriod(facts)) {
    const [entityId, periodLabel] = key.split("|") as [string, string];
    const nodeFacts = byNode(group);

    for (const [parent, children] of childrenOf) {
      const totalKey = children.find((c) => c.endsWith(".total"));
      if (!totalKey) continue;
      const totalFact = nodeFacts.get(totalKey);
      if (!totalFact) continue;

      const itemKeys = children.filter((c) => c !== totalKey);
      const itemFacts = itemKeys
        .map((k) => nodeFacts.get(k))
        .filter((f): f is GateFact => f !== undefined);
      if (itemFacts.length === 0) continue;

      const sum = itemFacts.reduce((acc, f) => acc + f.valueCents, 0n);
      const delta = abs(sum - totalFact.valueCents);
      if (delta > 100n) {
        issues.push({
          gate: "G1",
          severity: "error",
          blocking: true,
          entityId,
          periodLabel,
          message: `${totalKey} ≠ Σ(${parent} items): off by ${delta}¢`,
          implicatedFactIds: [totalFact.id, ...itemFacts.map((f) => f.id)],
          deltaCents: delta,
        });
      }
    }
  }
  return issues;
}

/* ── G2: balance sheet identity ───────────────────────────────────────── */

export function runG2(facts: GateFact[]): GateIssue[] {
  const issues: GateIssue[] = [];
  for (const [key, group] of groupByEntityPeriod(facts)) {
    const [entityId, periodLabel] = key.split("|") as [string, string];
    const nodes = byNode(group);
    const assets = nodes.get("bs.assets.total");
    if (!assets) continue;
    const combined = nodes.get("bs.total_liabilities_equity");
    const liabilities = nodes.get("bs.liabilities.total");
    const equity = nodes.get("bs.equity.total");

    let rhs: bigint | undefined;
    const implicated = [assets.id];
    if (combined) {
      rhs = combined.valueCents;
      implicated.push(combined.id);
    } else if (liabilities && equity) {
      rhs = liabilities.valueCents + equity.valueCents;
      implicated.push(liabilities.id, equity.id);
    }
    if (rhs === undefined) continue;

    const delta = abs(assets.valueCents - rhs);
    if (delta > 200n) {
      issues.push({
        gate: "G2",
        severity: "error",
        blocking: true,
        entityId,
        periodLabel,
        message: `Assets ≠ Liabilities + Equity: off by ${delta}¢`,
        implicatedFactIds: implicated,
        deltaCents: delta,
      });
    }
  }
  return issues;
}

/* ── G3: cross-document net-income tie-out ────────────────────────────── */

export function runG3(facts: GateFact[], cfg: GateConfig): GateIssue[] {
  const issues: GateIssue[] = [];
  for (const [key, group] of groupByEntityPeriod(facts)) {
    const [entityId, periodLabel] = key.split("|") as [string, string];
    // Net income facts from DIFFERENT logical documents (tax return vs P&L).
    const niFacts = group.filter((f) => f.taxonomyNodeKey === "is.net_income");
    const docs = new Map<string, GateFact>();
    for (const f of niFacts) docs.set(f.logicalDocumentId ?? f.id, f);
    const distinct = [...docs.values()];
    if (distinct.length < 2) continue;

    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        const a = distinct[i]!;
        const b = distinct[j]!;
        const delta = abs(a.valueCents - b.valueCents);
        const threshold = max(cfg.g3FloorCents, (abs(a.valueCents) * cfg.g3Bps) / 10_000n);
        if (delta > threshold) {
          issues.push({
            gate: "G3",
            severity: "error",
            blocking: true,
            entityId,
            periodLabel,
            message: `Net income diverges across documents by ${delta}¢ (threshold ${threshold}¢)`,
            implicatedFactIds: [a.id, b.id],
            deltaCents: delta,
          });
        }
      }
    }
  }
  return issues;
}

/* ── G4: registry relations + cross-form flows ────────────────────────── */

export function runG4(facts: GateFact[], cfg: GateConfig): GateIssue[] {
  const issues: GateIssue[] = [];
  for (const [key, group] of groupByEntityPeriod(facts)) {
    const [entityId, periodLabel] = key.split("|") as [string, string];
    const fields = bestByRegistryField(group);
    const first = (id: string): GateFact | undefined => fields.get(id);

    for (const rel of cfg.registryRelations) {
      const result = first(rel.result);
      if (!result) continue;
      const operands = rel.operands.map(first).filter((f): f is GateFact => f !== undefined);
      if (operands.length !== rel.operands.length) continue; // partial extraction

      let computed: bigint;
      if (rel.type === "sum") {
        computed = operands.reduce((acc, f) => acc + f.valueCents, 0n);
      } else {
        const [head, ...rest] = operands;
        computed = rest.reduce((acc, f) => acc - f.valueCents, head!.valueCents);
      }
      const delta = abs(computed - result.valueCents);
      if (delta > rel.toleranceCents) {
        issues.push({
          gate: "G4",
          severity: "error",
          blocking: true,
          entityId,
          periodLabel,
          message: `${rel.description}: off by ${delta}¢`,
          implicatedFactIds: [result.id, ...operands.map((f) => f.id)],
          deltaCents: delta,
        });
      }
    }

    for (const flow of cfg.registryFlows) {
      const from = first(flow.fromField);
      const to = first(flow.toField);
      if (!from || !to) continue;
      const delta = abs(from.valueCents - to.valueCents);
      if (delta > flow.toleranceCents) {
        issues.push({
          gate: "G4",
          severity: "error",
          blocking: true,
          entityId,
          periodLabel,
          message: `${flow.description}: off by ${delta}¢`,
          implicatedFactIds: [from.id, to.id],
          deltaCents: delta,
        });
      }
    }
  }
  return issues;
}

/* ── G5: transcript match (fraud signal) ──────────────────────────────── */

export function runG5(facts: GateFact[]): GateIssue[] {
  const issues: GateIssue[] = [];
  for (const [key, group] of groupByEntityPeriod(facts)) {
    const [entityId, periodLabel] = key.split("|") as [string, string];
    const fields = byRegistryField(group);
    for (const [fieldId, list] of fields) {
      const transcript = list.find((f) => f.method === "transcript");
      if (!transcript) continue;
      for (const parsed of list) {
        if (parsed.method === "transcript") continue;
        if (parsed.valueCents !== transcript.valueCents) {
          issues.push({
            gate: "G5",
            severity: "critical",
            blocking: true,
            entityId,
            periodLabel,
            message: `${fieldId}: parsed value contradicts the IRS transcript (possible document tampering)`,
            implicatedFactIds: [parsed.id, transcript.id],
            deltaCents: abs(parsed.valueCents - transcript.valueCents),
          });
        }
      }
    }
  }
  return issues;
}

/* ── G6: temporal sanity (flag only) ──────────────────────────────────── */

const FY_RE = /^FY(\d{4})$/;

export function runG6(facts: GateFact[], cfg: GateConfig): GateIssue[] {
  const issues: GateIssue[] = [];
  // (entity, node) → year → fact, fiscal years only.
  const series = new Map<string, Map<number, GateFact>>();
  for (const f of facts) {
    if (f.status === "rejected" || f.taxonomyNodeKey === null) continue;
    const year = FY_RE.exec(f.periodLabel)?.[1];
    if (!year) continue;
    const key = `${f.entityId}|${f.taxonomyNodeKey}`;
    let m = series.get(key);
    if (!m) {
      m = new Map();
      series.set(key, m);
    }
    m.set(Number(year), f);
  }

  for (const [key, byYear] of series) {
    const entityId = key.split("|")[0]!;
    const years = [...byYear.keys()].sort((a, b) => a - b);
    for (let i = 1; i < years.length; i++) {
      if (years[i]! !== years[i - 1]! + 1) continue;
      const prev = byYear.get(years[i - 1]!)!;
      const cur = byYear.get(years[i]!)!;
      if (prev.valueCents === 0n) continue; // no base → no ratio
      const swingBps = (abs(cur.valueCents - prev.valueCents) * 10_000n) / abs(prev.valueCents);
      if (swingBps > cfg.g6BandBps) {
        issues.push({
          gate: "G6",
          severity: "warning",
          blocking: false, // flag only, by spec
          entityId,
          periodLabel: cur.periodLabel,
          message: `${cur.taxonomyNodeKey}: YoY swing of ${swingBps} bps exceeds the ${cfg.g6BandBps} bps band`,
          implicatedFactIds: [prev.id, cur.id],
          deltaCents: abs(cur.valueCents - prev.valueCents),
        });
      }
    }
  }
  return issues;
}

/* ── the runner ───────────────────────────────────────────────────────── */

export function runGates(facts: GateFact[], cfg: GateConfig): GateRunResult {
  const issues = [
    ...runG1(facts, cfg.taxonomy),
    ...runG2(facts),
    ...runG3(facts, cfg),
    ...runG4(facts, cfg),
    ...runG5(facts),
    ...runG6(facts, cfg),
  ];
  const blockedFactIds = new Set<string>();
  for (const issue of issues) {
    if (issue.blocking) for (const id of issue.implicatedFactIds) blockedFactIds.add(id);
  }
  return { issues, blockedFactIds };
}
