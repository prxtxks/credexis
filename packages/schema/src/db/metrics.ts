/**
 * Loan scenarios, computed metrics, issues (Blueprint §5).
 *
 * computed_metrics stores engine output only — the engine (M7) is the sole
 * writer (Iron Law #3). Values are either integer cents OR a fixed-point
 * ratio (mantissa/scale) — never a float (Iron Law #2).
 */

import { bigint, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { issueSeverity, issueStatus, metricValueKind, validationGate } from "./enums.js";
import { deals, entities, periods } from "./deals.js";
import { tenants } from "./tenancy.js";

/** Rate specification, e.g. {type:"fixed", bps:9_50} or {type:"prime_spread", spread_bps:275}. */
export interface RateSpec {
  type: "fixed" | "prime_spread";
  /** Basis points — integers, never float percentages. */
  bps?: number;
  spread_bps?: number;
}

export const loanScenarios = pgTable(
  "loan_scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    name: text("name").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    rateSpec: jsonb("rate_spec").$type<RateSpec>().notNull(),
    termMonths: integer("term_months").notNull(),
    /** Use of proceeds, equity injection, seller-debt replacement, … */
    structure: jsonb("structure").$type<Record<string, unknown>>(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("loan_scenarios_tenant_idx").on(t.tenantId),
    index("loan_scenarios_deal_idx").on(t.dealId),
  ],
);

export const computedMetrics = pgTable(
  "computed_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    scenarioId: uuid("scenario_id").references(() => loanScenarios.id),
    /** Stamped on every result — reproducibility (Blueprint §7). */
    engineVersion: text("engine_version").notNull(),
    /** Metric key, e.g. "dscr_business", "cfads", "current_ratio". */
    metric: text("metric").notNull(),
    /** Null entity = deal-global (e.g. global cash flow DSCR). */
    entityId: uuid("entity_id").references(() => entities.id),
    periodId: uuid("period_id").references(() => periods.id),
    /**
     * The engine's period label ("FY2023"). Deal-global metrics (global
     * cash flow, global DSCR) are period-scoped without belonging to one
     * entity's periods row, so the label is stored denormalized; period_id
     * stays for entity-scoped metrics.
     */
    periodLabel: text("period_label"),
    valueKind: metricValueKind("value_kind").notNull(),
    /** Populated when value_kind = cents. */
    valueCents: bigint("value_cents", { mode: "bigint" }),
    /** Populated when value_kind = ratio: value = mantissa / 10^scale. */
    ratioMantissa: bigint("ratio_mantissa", { mode: "bigint" }),
    ratioScale: integer("ratio_scale"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("computed_metrics_tenant_idx").on(t.tenantId),
    index("computed_metrics_deal_scenario_idx").on(t.dealId, t.scenarioId),
  ],
);

/** Gate violations (Blueprint §4.5) — blocking and visible (Iron Law #6). */
export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    gate: validationGate("gate").notNull(),
    severity: issueSeverity("severity").notNull(),
    /** The facts implicated — these cannot auto-accept while the issue is open. */
    factIds: uuid("fact_ids").array().notNull().default([]),
    message: text("message").notNull(),
    status: issueStatus("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("issues_tenant_idx").on(t.tenantId), index("issues_deal_idx").on(t.dealId)],
);
