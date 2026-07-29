-- M12.1 review fixes (adversarial panel, 2026-07-29). Three DB-side
-- defects, one of them a live production bug predating this work.

-- (a) NOTIFICATIONS DEDUPE INDEX — LIVE BUG FIX.
-- 0015 created the dedupe index as PARTIAL (WHERE dedupe_key IS NOT NULL).
-- Postgres cannot infer a partial unique index from a plain
-- `ON CONFLICT (recipient_id, dedupe_key)` target, so EVERY pipeline
-- notification upsert (document_processed since M11.5, identity_review
-- since M11.6) has been failing with 42P10 and being swallowed by the
-- best-effort catch — the bell has never received a pipeline card.
-- A NON-partial unique index has identical semantics here (NULL dedupe_key
-- values are distinct under the default NULLS DISTINCT, so un-deduped rows
-- are still unconstrained) AND is inferrable by ON CONFLICT.
DROP INDEX IF EXISTS notifications_recipient_dedupe_uq;--> statement-breakpoint
CREATE UNIQUE INDEX notifications_recipient_dedupe_uq
  ON "notifications" (recipient_id, dedupe_key);--> statement-breakpoint

-- (b) QUOTA TRIGGER — serialize per deal and match the JS parser exactly.
-- Was: unlocked read-then-check under READ COMMITTED, so N concurrent
-- inserts each saw the pre-burst totals and all committed (a parallel
-- uploader blew straight through both ceilings — precisely the borrower
-- threat model this backstop exists for). Now: a transaction-scoped
-- advisory lock keyed on the deal makes the check-and-insert atomic per
-- deal; concurrent uploads to DIFFERENT deals still run in parallel.
-- Override parsing now mirrors resolveDealLimits exactly: jsonb NUMBER
-- type only (a JSON string "30" is not an override), positive integers,
-- no digit-width ceiling.
CREATE OR REPLACE FUNCTION public.enforce_deal_upload_limits()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
declare
  v_settings jsonb;
  v_docs_raw jsonb;
  v_bytes_raw jsonb;
  v_max_docs bigint := 60;          -- mirrors DEAL_LIMIT_DEFAULTS
  v_max_bytes bigint := 1073741824; -- (packages/shared/src/limits.ts)
  v_count bigint;
  v_bytes bigint;
begin
  -- Serialize concurrent inserts for THIS deal only.
  perform pg_advisory_xact_lock(hashtextextended(new.deal_id::text, 0));

  select settings into v_settings from tenants where id = new.tenant_id;
  v_docs_raw := v_settings #> '{limits,maxDocsPerDeal}';
  v_bytes_raw := v_settings #> '{limits,maxBytesPerDeal}';

  if jsonb_typeof(v_docs_raw) = 'number'
     and (v_docs_raw)::text ~ '^[1-9][0-9]*$' then
    v_max_docs := (v_docs_raw)::text::bigint;
  end if;
  if jsonb_typeof(v_bytes_raw) = 'number'
     and (v_bytes_raw)::text ~ '^[1-9][0-9]*$' then
    v_max_bytes := (v_bytes_raw)::text::bigint;
  end if;

  select count(*), coalesce(sum(bytes), 0)
    into v_count, v_bytes
    from documents
   where deal_id = new.deal_id;

  if v_count >= v_max_docs then
    raise exception 'deal document limit reached (% files)', v_max_docs;
  end if;
  if v_bytes + new.bytes > v_max_bytes then
    raise exception 'deal storage limit reached (% bytes total)', v_max_bytes;
  end if;

  return new;
end;
$$;--> statement-breakpoint

-- (c) DEAL SPEND — a SQL aggregate, not a client-side row sum.
-- The worker summed extraction_runs rows fetched over PostgREST, which
-- caps responses at db-max-rows (1000): on a large deal the ceiling
-- silently stopped counting — weakest on exactly the deals it bounds.
-- Aggregating in the database is exact at any row count.
CREATE OR REPLACE FUNCTION public.deal_extraction_spend(p_deal uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select coalesce(sum(cost_micro_usd), 0)::bigint
    from extraction_runs
   where deal_id = p_deal
$$;--> statement-breakpoint
-- A definer bypasses RLS, so granting this to `authenticated` would let
-- any signed-in user learn ANY tenant's deal spend by guessing a uuid.
-- Worker only; the costs page keeps reading through RLS as it does today.
REVOKE ALL ON FUNCTION public.deal_extraction_spend(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.deal_extraction_spend(uuid) TO service_role;
