-- M11.2 (platform shell): bootstrap function + deactivation kill-switch +
-- the self-parent CHECK the TS schema does not model. Custom migration
-- (functions/constraints are outside drizzle-kit's diff, like 0001/0004).
-- Design: docs/design/platform/01-identity-rbac.md §§1,4,6 + synthesis A1.

-- (a) LSP seam safety: an org can never parent itself.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_no_self_parent'
  ) THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_no_self_parent"
      CHECK ("parent_tenant_id" IS DISTINCT FROM "id");
  END IF;
END $$;--> statement-breakpoint

-- (b) deactivation kill-switch: a deactivated profile resolves to no
-- tenant and no role — every RLS policy goes dark instantly, without
-- deleting the row (audit attribution survives; we never delete).
CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select tenant_id from public.profiles
  where id = auth.uid() and status = 'active'
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select role from public.profiles
  where id = auth.uid() and status = 'active'
$$;--> statement-breakpoint

-- (c) owner bootstrap: the ONLY way a tenants/profiles pair is born from
-- the app (no INSERT policies exist on either table — function-only).
-- References 'org_owner', which landed one migration file earlier (0010)
-- per the enum-reference rule (synthesis §4).
CREATE OR REPLACE FUNCTION public.create_organization(p_name text, p_kind org_kind)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_tenant uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile already exists';
  end if;
  if p_name is null or length(trim(p_name)) < 2 or length(p_name) > 120 then
    raise exception 'invalid organization name';
  end if;
  select email into v_email from auth.users where id = v_uid;

  insert into public.tenants (name, kind) values (trim(p_name), p_kind)
    returning id into v_tenant;
  insert into public.profiles (id, tenant_id, email, role)
    values (v_uid, v_tenant, coalesce(v_email, ''), 'org_owner');
  return v_tenant;
end
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_organization(text, org_kind) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_organization(text, org_kind) TO authenticated;
