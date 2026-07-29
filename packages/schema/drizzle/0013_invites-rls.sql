-- M11.3 (platform shell): tier lattice + invite RLS + accept_invite +
-- audit triggers on identity tables. Custom migration (functions/policies
-- are outside drizzle-kit's diff). Design 01 §§4,7,9 + synthesis A1 fix:
-- the lattice is enforced HERE, at the DB layer — tRPC guards are UX.

-- (a) role tier lattice. org_owner outranks admin; nobody grants at or
-- above their own tier (so org_owner is never mintable via invites, and
-- admins cannot mint admins).
CREATE OR REPLACE FUNCTION public.role_tier(r user_role) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  select case r
    when 'org_owner' then 4
    when 'admin' then 3
    when 'underwriter' then 2
    when 'viewer' then 1
    else 0
  end
$$;--> statement-breakpoint

-- (b) invites RLS (append-mostly; acceptance happens inside the definer)
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY invites_select ON "invites" FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.role_tier(public.current_user_role()) >= 3);--> statement-breakpoint
CREATE POLICY invites_insert ON "invites" FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND invited_by = auth.uid()
              AND public.role_tier(public.current_user_role()) >= 3
              AND public.role_tier(role) < public.role_tier(public.current_user_role()));--> statement-breakpoint
CREATE POLICY invites_update ON "invites" FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.role_tier(public.current_user_role()) >= 3)
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint

-- (c) profiles management policy (A1): admins+ manage members BELOW their
-- tier; org_owner rows are untouchable by anyone but the owner themself;
-- no self-service role changes through this policy.
CREATE POLICY profiles_update_manage ON "profiles" FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND id <> auth.uid()
         AND role <> 'org_owner'
         AND public.role_tier(public.current_user_role()) >= 3)
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.role_tier(role) < public.role_tier(public.current_user_role()));--> statement-breakpoint

-- (d) accept: definer converts a matching pending claim into membership.
CREATE OR REPLACE FUNCTION public.accept_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'account already belongs to a workspace';
  end if;
  select email into v_email from auth.users where id = v_uid;

  select * into v_inv from public.invites
    where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')
      and accepted_at is null and revoked_at is null and expires_at > now()
    limit 1;
  if v_inv.id is null then
    raise exception 'invite not found, expired, or revoked';
  end if;
  if lower(v_inv.email) <> lower(coalesce(v_email, '')) then
    raise exception 'invite was issued to a different email address';
  end if;

  insert into public.profiles (id, tenant_id, email, role)
    values (v_uid, v_inv.tenant_id, coalesce(v_email, ''), v_inv.role);
  update public.invites set accepted_at = now() where id = v_inv.id;
  return v_inv.tenant_id;
end
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.accept_invite(text) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.accept_invite(text) TO authenticated;--> statement-breakpoint

-- (e) audit the whole identity chain (0004's audit_record stores row
-- images). invites.token_hash appearing in audit_log is acceptable: it is
-- a sha256 digest — the URL token itself is the secret and is never
-- stored anywhere. No other sensitive column exists on these tables.
CREATE TRIGGER profiles_audit AFTER INSERT OR UPDATE OR DELETE ON "profiles"
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();--> statement-breakpoint
CREATE TRIGGER invites_audit AFTER INSERT OR UPDATE OR DELETE ON "invites"
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();--> statement-breakpoint
CREATE TRIGGER tenants_audit AFTER INSERT OR UPDATE OR DELETE ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();
