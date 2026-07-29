-- M12.0 hotfix, found by the RLS harness's first live run: audit_record()
-- read new.tenant_id unconditionally, but 0013 attached it to "tenants",
-- whose tenant id is the row's own "id". Result: EVERY tenants
-- insert/update/delete errored (42703) — including create_organization(),
-- so new-org signup has been broken since 0013 landed on tables it was
-- never tested against. Rewritten with jsonb field extraction: tenant_id
-- when present, the row id on the tenants table itself. audit_log.tenant_id
-- stays NOT NULL, so attaching this trigger to a tenant-less table still
-- fails loudly instead of recording an unattributed row.
create or replace function public.audit_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_image jsonb;
  v_tenant uuid;
  v_row_id text;
begin
  if tg_op = 'INSERT' then
    v_before := null;
    v_after := to_jsonb(new);
    v_image := v_after;
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_image := v_after;
  else -- DELETE
    v_before := to_jsonb(old);
    v_after := null;
    v_image := v_before;
  end if;

  v_row_id := v_image->>'id';
  v_tenant := coalesce(
    (v_image->>'tenant_id')::uuid,
    case when tg_table_name = 'tenants' then (v_image->>'id')::uuid end
  );

  insert into public.audit_log (tenant_id, actor_id, action, table_name, row_id, before, after)
  values (
    v_tenant,
    auth.uid(), -- null on worker/admin connections (no JWT in session)
    tg_op,
    tg_table_name,
    v_row_id,
    v_before,
    v_after
  );
  return coalesce(new, old);
end;
$$;
