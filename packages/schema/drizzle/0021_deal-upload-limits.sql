-- M12.1 (borrower-portal prerequisite): per-deal upload limits enforced at
-- the DATABASE — the backstop no caller can skip, including the worker and
-- the future borrower upload path. The friendly wall with readable errors
-- lives in the upload route; this trigger is the guarantee.
--
-- Limits resolve from tenants.settings -> 'limits' with hard defaults that
-- MIRROR @credexis/shared limits.ts (DEAL_LIMIT_DEFAULTS): 60 docs,
-- 1 GiB total. Change BOTH places together. Overrides count only when they
-- are positive integers (same rule as resolveDealLimits) — a malformed
-- settings blob falls back to defaults, never OFF.
CREATE OR REPLACE FUNCTION public.enforce_deal_upload_limits()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
declare
  v_settings jsonb;
  v_max_docs int;
  v_max_bytes bigint;
  v_count int;
  v_bytes bigint;
begin
  select settings into v_settings from tenants where id = new.tenant_id;

  v_max_docs := coalesce(
    case when (v_settings #>> '{limits,maxDocsPerDeal}') ~ '^[1-9][0-9]{0,8}$'
         then (v_settings #>> '{limits,maxDocsPerDeal}')::int end,
    60);
  v_max_bytes := coalesce(
    case when (v_settings #>> '{limits,maxBytesPerDeal}') ~ '^[1-9][0-9]{0,14}$'
         then (v_settings #>> '{limits,maxBytesPerDeal}')::bigint end,
    1073741824);

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
CREATE TRIGGER documents_upload_limits BEFORE INSERT ON "documents"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_deal_upload_limits();
