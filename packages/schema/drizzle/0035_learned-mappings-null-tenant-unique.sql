-- M14.3: global learned mappings (tenant_id NULL) were never deduplicated.
-- Postgres UNIQUE treats NULLs as distinct, so the (tenant_id, label_norm)
-- index quietly admitted duplicates for every global write-back; the next
-- read of a duplicated label made `.maybeSingle()` throw and failed the
-- whole statement extraction ("total assets" had 16 copies in prod).
--
-- 1. Keep the best row per (tenant, label): human beats llm, then highest
--    usage_count, then newest.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, label_norm
           ORDER BY (source = 'human') DESC, usage_count DESC, updated_at DESC, id DESC
         ) AS rn
  FROM learned_mappings
)
DELETE FROM learned_mappings lm
USING ranked r
WHERE lm.id = r.id AND r.rn > 1;

-- 2. Recreate the uniqueness so NULL tenants collide like real ones.
DROP INDEX IF EXISTS learned_mappings_tenant_label;
CREATE UNIQUE INDEX learned_mappings_tenant_label
  ON learned_mappings (tenant_id, label_norm) NULLS NOT DISTINCT;
