-- M2.5: audit log writer — every fact/addback/scenario mutation recorded
-- (before/after, actor), append-only (Blueprint §5, §11; bank requirement).
--
-- Implemented as DATABASE TRIGGERS, not app middleware: triggers see every
-- mutation path — tRPC, pipeline worker, admin tooling — so nothing can
-- write around the audit trail. The trigger function is SECURITY DEFINER;
-- direct inserts into audit_log are removed entirely (0001's insert
-- policies are dropped below): audit rows exist iff a real mutation
-- produced them.

create or replace function public.audit_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_tenant uuid;
  v_row_id text;
begin
  if tg_op = 'INSERT' then
    v_before := null;
    v_after := to_jsonb(new);
    v_tenant := new.tenant_id;
    v_row_id := new.id::text;
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_tenant := new.tenant_id;
    v_row_id := new.id::text;
  else -- DELETE
    v_before := to_jsonb(old);
    v_after := null;
    v_tenant := old.tenant_id;
    v_row_id := old.id::text;
  end if;

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
--> statement-breakpoint
-- The audited spine: facts, addbacks, loan_scenarios (task M2.5 scope).
create trigger facts_audit
  after insert or update or delete on public.facts
  for each row execute function public.audit_record();
--> statement-breakpoint
create trigger addbacks_audit
  after insert or update or delete on public.addbacks
  for each row execute function public.audit_record();
--> statement-breakpoint
create trigger loan_scenarios_audit
  after insert or update or delete on public.loan_scenarios
  for each row execute function public.audit_record();
--> statement-breakpoint
-- Tighten append-only: direct inserts are gone (trigger-only via definer),
-- and UPDATE/DELETE stay revoked from every API-reachable role — defense in
-- depth on top of RLS having no policies for those commands.
drop policy if exists audit_log_insert on public.audit_log;
--> statement-breakpoint
drop policy if exists worker_audit_insert on public.audit_log;
--> statement-breakpoint
revoke insert, update, delete on public.audit_log from authenticated;
--> statement-breakpoint
revoke insert, update, delete on public.audit_log from anon;
--> statement-breakpoint
revoke update, delete on public.audit_log from service_role;
--> statement-breakpoint
revoke insert, update, delete on public.audit_log from credexis_worker;
