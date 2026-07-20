#!/usr/bin/env node
/**
 * Token-authenticated seed runner (`pnpm db:seed:api`) — M2.6.
 *
 * Seeds the canonical taxonomy v1 and the SOP 50 10 8 policy pack via the
 * Supabase Management API (SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF
 * only). Idempotent: taxonomy upserts by key; the policy pack upserts by its
 * stable seed id WHILE ITS rules are still draft — once a pack is marked
 * reviewed, seeding refuses to touch it (packs deals were underwritten under
 * are immutable, Iron Law #8).
 */

import { TAXONOMY_V1 } from "../seed/taxonomy.js";
import { LEARNED_MAPPINGS_SEED } from "../seed/learned-mappings.js";
import {
  POLICY_PACK_2026_03,
  POLICY_PACK_EFFECTIVE_DATE,
  POLICY_PACK_SEED_ID,
  POLICY_PACK_VERSION,
  policyPackRulesSchema,
} from "../seed/policy-pack.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (source .env.local)`);
  return v;
}

async function runSql(ref: string, token: string, query: string): Promise<unknown> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`seed sql failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  return res.json();
}

const esc = (s: string) => s.replace(/'/g, "''");

async function main(): Promise<void> {
  const token = requireEnv("SUPABASE_ACCESS_TOKEN");
  const ref = requireEnv("SUPABASE_PROJECT_REF");

  // Validate before touching the DB — a malformed pack must never land.
  policyPackRulesSchema.parse(POLICY_PACK_2026_03);

  const taxonomyValues = TAXONOMY_V1.map(
    (n) =>
      `('${esc(n.key)}', ${n.parentKey ? `'${esc(n.parentKey)}'` : "null"}, '${esc(n.label)}', ` +
      `'${n.statement}', ${n.isAddbackRelevant}, ${n.sortOrder}, ${n.version})`,
  ).join(",\n    ");

  const taxonomySql = `
begin;
insert into public.taxonomy_nodes
    (key, parent_key, label, statement, is_addback_relevant, sort_order, version)
  values
    ${taxonomyValues}
  on conflict (key) do update set
    parent_key = excluded.parent_key,
    label = excluded.label,
    statement = excluded.statement,
    is_addback_relevant = excluded.is_addback_relevant,
    sort_order = excluded.sort_order,
    version = excluded.version;
commit;
select count(*)::int as n from public.taxonomy_nodes;`;

  const taxonomyResult = (await runSql(ref, token, taxonomySql)) as Array<{ n: number }>;
  console.log(`taxonomy: ${TAXONOMY_V1.length} nodes seeded (table now ${taxonomyResult[0]?.n})`);

  // Learned mappings (global pool): corpus-verified label↔node pairs so
  // the mapper's first encounter with known vocabulary costs zero LLM
  // calls. Normalization MUST match normalizeLabel in the taxonomy
  // mapper (lowercase, strip non-alphanumerics, collapse whitespace).
  const normLabel = (l: string) =>
    l
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const mappingValues = LEARNED_MAPPINGS_SEED.map(
    (m) => `(null, '${esc(normLabel(m.label))}', '${esc(m.node)}', 0.95, 'human', 1)`,
  ).join(",\n    ");
  await runSql(
    ref,
    token,
    `
    insert into public.learned_mappings
      (tenant_id, label_norm, taxonomy_node_key, confidence, source, usage_count)
    values
    ${mappingValues}
    on conflict (tenant_id, label_norm) where tenant_id is null
    do update set taxonomy_node_key = excluded.taxonomy_node_key,
                  confidence = excluded.confidence,
                  source = 'human'
    returning label_norm;
  `,
  );
  console.log(`learned mappings: ${LEARNED_MAPPINGS_SEED.length} seeded (global pool)`);

  const rulesJson = esc(JSON.stringify(POLICY_PACK_2026_03));
  const packSql = `
insert into public.policy_packs (id, version, effective_date, rules)
  values ('${POLICY_PACK_SEED_ID}', '${POLICY_PACK_VERSION}', '${POLICY_PACK_EFFECTIVE_DATE}', '${rulesJson}'::jsonb)
  on conflict (id) do update set
    version = excluded.version,
    effective_date = excluded.effective_date,
    rules = excluded.rules
  -- immutability guard: only a draft pack may be re-seeded
  where policy_packs.rules->>'reviewStatus' = 'draft'
  returning (rules->>'reviewStatus') as review_status;`;

  const packResult = (await runSql(ref, token, packSql)) as Array<{ review_status: string }>;
  if (packResult.length === 0) {
    console.log(`policy pack ${POLICY_PACK_VERSION}: already reviewed — left untouched`);
  } else {
    console.log(
      `policy pack ${POLICY_PACK_VERSION}: seeded (reviewStatus=${packResult[0]?.review_status})`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
