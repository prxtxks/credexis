-- M2.2: Row-Level Security for every table (Iron Law #7).
--
-- Tenant derivation: the caller's tenant comes from their profiles row keyed
-- by auth.uid() (the JWT `sub`). SECURITY DEFINER helpers avoid recursive RLS
-- lookups. Deny-by-default: RLS is enabled on ALL tables; only the policies
-- below grant access. anon gets nothing at all (privileges revoked).
--
-- Roles: viewers read; underwriters/admins write. Fine-grained route-level
-- enforcement is M2.3; these are the database floor.
--
-- Pipeline worker: `credexis_worker` NOLOGIN role with table-scoped policies
-- (pipeline tables only) — the structural alternative to using the
-- RLS-bypassing service-role key in request paths (post-mortem §0.2).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.current_tenant_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

revoke execute on function public.current_tenant_id() from public, anon;
revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.current_user_role() to authenticated;

-- ---------------------------------------------------------------------------
-- anon: no access to any application table (defense in depth; RLS would deny
-- rows anyway, but anon has no business touching these relations at all).
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table (deny-by-default until a policy grants access).
-- ---------------------------------------------------------------------------
alter table public.tenants            enable row level security;
alter table public.profiles           enable row level security;
alter table public.deals              enable row level security;
alter table public.entities           enable row level security;
alter table public.periods            enable row level security;
alter table public.documents          enable row level security;
alter table public.logical_documents  enable row level security;
alter table public.pages              enable row level security;
alter table public.facts              enable row level security;
alter table public.extraction_runs    enable row level security;
alter table public.addbacks           enable row level security;
alter table public.loan_scenarios     enable row level security;
alter table public.computed_metrics   enable row level security;
alter table public.issues             enable row level security;
alter table public.audit_log          enable row level security;
alter table public.taxonomy_nodes     enable row level security;
alter table public.form_registry      enable row level security;
alter table public.learned_mappings   enable row level security;
alter table public.policy_packs      enable row level security;

-- ---------------------------------------------------------------------------
-- Global reference data: readable by any signed-in user; writable by nobody
-- (seeds/updates run as postgres via migrations — Iron Law #8).
-- ---------------------------------------------------------------------------
create policy taxonomy_nodes_read on public.taxonomy_nodes
  for select to authenticated using (true);
create policy form_registry_read on public.form_registry
  for select to authenticated using (true);
create policy policy_packs_read on public.policy_packs
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Tenancy root
-- ---------------------------------------------------------------------------
create policy tenants_select_own on public.tenants
  for select to authenticated using (id = public.current_tenant_id());

create policy profiles_select_same_tenant on public.profiles
  for select to authenticated using (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- Tenant tables. Pattern:
--   select: any member of the tenant (viewer included)
--   insert/update: admin + underwriter, row must stay in caller's tenant
--   delete: admin only
-- ---------------------------------------------------------------------------

-- deals
create policy deals_select on public.deals
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy deals_insert on public.deals
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
create policy deals_update on public.deals
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'))
  with check (tenant_id = public.current_tenant_id());
create policy deals_delete on public.deals
  for delete to authenticated using (
    tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- entities
create policy entities_select on public.entities
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy entities_insert on public.entities
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
create policy entities_update on public.entities
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'))
  with check (tenant_id = public.current_tenant_id());
create policy entities_delete on public.entities
  for delete to authenticated using (
    tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- periods
create policy periods_select on public.periods
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy periods_insert on public.periods
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
create policy periods_update on public.periods
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'))
  with check (tenant_id = public.current_tenant_id());
create policy periods_delete on public.periods
  for delete to authenticated using (
    tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- documents
create policy documents_select on public.documents
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy documents_insert on public.documents
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
create policy documents_update on public.documents
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'))
  with check (tenant_id = public.current_tenant_id());
create policy documents_delete on public.documents
  for delete to authenticated using (
    tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- logical_documents
create policy logical_documents_select on public.logical_documents
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy logical_documents_insert on public.logical_documents
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
create policy logical_documents_update on public.logical_documents
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'))
  with check (tenant_id = public.current_tenant_id());
create policy logical_documents_delete on public.logical_documents
  for delete to authenticated using (
    tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- pages
create policy pages_select on public.pages
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy pages_insert on public.pages
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
create policy pages_update on public.pages
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'))
  with check (tenant_id = public.current_tenant_id());
create policy pages_delete on public.pages
  for delete to authenticated using (
    tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- facts (append-mostly is enforced by app semantics + audit; RLS scopes rows)
create policy facts_select on public.facts
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy facts_insert on public.facts
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
create policy facts_update on public.facts
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'))
  with check (tenant_id = public.current_tenant_id());
create policy facts_delete on public.facts
  for delete to authenticated using (
    tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- extraction_runs
create policy extraction_runs_select on public.extraction_runs
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy extraction_runs_insert on public.extraction_runs
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
create policy extraction_runs_update on public.extraction_runs
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'))
  with check (tenant_id = public.current_tenant_id());

-- addbacks
create policy addbacks_select on public.addbacks
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy addbacks_insert on public.addbacks
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
create policy addbacks_update on public.addbacks
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'))
  with check (tenant_id = public.current_tenant_id());
create policy addbacks_delete on public.addbacks
  for delete to authenticated using (
    tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- loan_scenarios
create policy loan_scenarios_select on public.loan_scenarios
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy loan_scenarios_insert on public.loan_scenarios
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
create policy loan_scenarios_update on public.loan_scenarios
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'))
  with check (tenant_id = public.current_tenant_id());
create policy loan_scenarios_delete on public.loan_scenarios
  for delete to authenticated using (
    tenant_id = public.current_tenant_id() and public.current_user_role() = 'admin');

-- computed_metrics (engine output: users read; writes come from server flows)
create policy computed_metrics_select on public.computed_metrics
  for select to authenticated using (tenant_id = public.current_tenant_id());

-- issues
create policy issues_select on public.issues
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy issues_insert on public.issues
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
create policy issues_update on public.issues
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'))
  with check (tenant_id = public.current_tenant_id());

-- learned_mappings: tenant rows + global (tenant_id null) readable; only
-- tenant-scoped rows writable by that tenant's admin/underwriter.
create policy learned_mappings_select on public.learned_mappings
  for select to authenticated using (
    tenant_id is null or tenant_id = public.current_tenant_id());
create policy learned_mappings_insert on public.learned_mappings
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
create policy learned_mappings_update on public.learned_mappings
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'))
  with check (tenant_id = public.current_tenant_id());

-- audit_log: append-only for everyone (M2.5 semantics enforced at the DB).
create policy audit_log_select on public.audit_log
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy audit_log_insert on public.audit_log
  for insert to authenticated with check (tenant_id = public.current_tenant_id());
revoke update, delete on public.audit_log from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pipeline worker role: NOLOGIN group role with access scoped to pipeline
-- tables only. Workers connect as a login user granted this role (M3) and do
-- explicit tenant checks in code — the service-role key never appears in a
-- request path (Iron Law #7).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'credexis_worker') then
    create role credexis_worker nologin;
  end if;
end
$$;

grant usage on schema public to credexis_worker;
grant select on public.tenants, public.deals, public.entities, public.periods,
  public.taxonomy_nodes, public.form_registry, public.policy_packs,
  public.learned_mappings to credexis_worker;
grant select, insert, update on public.documents, public.logical_documents,
  public.pages, public.facts, public.extraction_runs, public.issues
  to credexis_worker;
grant insert on public.audit_log to credexis_worker;

-- Worker policies (RLS still applies to the role; scope = pipeline tables).
create policy worker_documents_all on public.documents
  for all to credexis_worker using (true) with check (true);
create policy worker_logical_documents_all on public.logical_documents
  for all to credexis_worker using (true) with check (true);
create policy worker_pages_all on public.pages
  for all to credexis_worker using (true) with check (true);
create policy worker_facts_all on public.facts
  for all to credexis_worker using (true) with check (true);
create policy worker_extraction_runs_all on public.extraction_runs
  for all to credexis_worker using (true) with check (true);
create policy worker_issues_all on public.issues
  for all to credexis_worker using (true) with check (true);
create policy worker_audit_insert on public.audit_log
  for insert to credexis_worker with check (true);
create policy worker_reference_read_tenants on public.tenants
  for select to credexis_worker using (true);
create policy worker_reference_read_deals on public.deals
  for select to credexis_worker using (true);
create policy worker_reference_read_entities on public.entities
  for select to credexis_worker using (true);
create policy worker_reference_read_periods on public.periods
  for select to credexis_worker using (true);
create policy worker_reference_read_taxonomy on public.taxonomy_nodes
  for select to credexis_worker using (true);
create policy worker_reference_read_registry on public.form_registry
  for select to credexis_worker using (true);
create policy worker_reference_read_policy_packs on public.policy_packs
  for select to credexis_worker using (true);
create policy worker_reference_read_mappings on public.learned_mappings
  for select to credexis_worker using (true);
