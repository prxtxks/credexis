-- M12.1 PR2 — the borrower ACCESS PATH.
-- docs/design/platform/05-borrower-portal.md §§3.2, 5.2–5.4, 6.1, 7.1.
--
-- After this migration a borrower can, in principle, reach exactly TWO
-- policies in the entire database — both on storage.objects, both scoped to
-- their own invite's prefix. Nothing in `public` is reachable by them. No
-- borrower can exist yet either: claim_borrower_invite() lands in the next
-- migration, so auth_user_id is still unset on every row.

-- ── (a) One settings parser, shared by every limit key ──────────────────
-- Mirrors resolveDealLimits/resolveInviteLimits in @credexis/shared: jsonb
-- NUMBER only, positive integers, malformed/absent → default, NEVER off.
CREATE OR REPLACE FUNCTION public.settings_limit(p_settings jsonb, p_key text, p_default bigint)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE AS $$
declare v jsonb;
begin
  v := p_settings #> array['limits', p_key];
  if jsonb_typeof(v) = 'number' and (v)::text ~ '^[1-9][0-9]*$' then
    return (v)::text::bigint;
  end if;
  return p_default;
end $$;--> statement-breakpoint

-- ── (b) Who am I? — the borrower's entire authority ─────────────────────
-- SECURITY DEFINER because borrowers have no SELECT policy on
-- borrower_invites: they can never read the table, only be resolved by it.
-- Every liveness condition (active, unrevoked, unexpired) is re-checked on
-- every statement, so revoking an invite takes effect immediately rather
-- than at token refresh.
CREATE OR REPLACE FUNCTION public.current_invite_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select coalesce(array_agg(i.id), '{}'::uuid[])
    from public.borrower_invites i
   where auth.uid() is not null
     and i.auth_user_id = auth.uid()
     and i.status = 'active' and i.revoked_at is null and i.expires_at > now()
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.has_borrower_invite() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists (
    select 1 from public.borrower_invites i
     where auth.uid() is not null and i.auth_user_id = auth.uid()
       and i.status = 'active' and i.revoked_at is null and i.expires_at > now())
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.current_invite_ids() FROM public, anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.has_borrower_invite() FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_invite_ids() TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.has_borrower_invite() TO authenticated;--> statement-breakpoint

-- ── (c) Storage path validator (B3) ─────────────────────────────────────
-- Grammar: <tenant>/deals/<deal>/borrower-uploads/<invite>/<sha256>.<ext>
-- EVERY segment is validated against the caller's own invite. Comparisons
-- are uuid::text = segment, never segment::uuid — a malformed segment must
-- return false, not raise: a cast error inside a policy is both a denial of
-- service and an oracle.
CREATE OR REPLACE FUNCTION public.borrower_upload_key_ok(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare s text[];
begin
  if p_name is null then return false; end if;
  s := string_to_array(p_name, '/');
  if array_length(s,1) is distinct from 6 then return false; end if;
  if s[2] <> 'deals' or s[4] <> 'borrower-uploads' then return false; end if;
  if s[6] !~ '^[0-9a-f]{64}\.(pdf|png|jpg|tif|xlsx|xls)$' then return false; end if;
  return exists (
    select 1 from public.borrower_invites i
     where auth.uid() is not null
       and i.auth_user_id = auth.uid()
       and i.status = 'active' and i.revoked_at is null and i.expires_at > now()
       and i.tenant_id::text = s[1]
       and i.deal_id::text   = s[3]
       and i.id::text        = s[5]);
end $$;--> statement-breakpoint

-- ── (d) Object budget ───────────────────────────────────────────────────
-- Row quotas bound `documents` ROWS, not bytes in the bucket. Without this a
-- borrower could park unlimited 50 MiB objects that no quota counts and no
-- screen shows.
--
-- NO SUPPORTING INDEX, deliberately. `storage.objects` is owned by
-- supabase_storage_admin; `postgres` may manage its POLICIES but not its
-- structure, so `CREATE INDEX` on it fails with 42501 through every route we
-- have (verified 2026-07-29, including a superuser role-grant attempt, which
-- Supabase reserves). The design anticipated this: correctness does not
-- depend on the index — a prefix count over one invite's objects is a
-- milliseconds-scale scan at pilot volumes. If it ever bites, the fix is an
-- index created by Supabase support, not a weaker check.
CREATE OR REPLACE FUNCTION public.borrower_object_budget_ok(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, storage AS $$
declare s text[]; v_prefix text; v_max bigint; v_n bigint;
begin
  s := string_to_array(p_name, '/');
  if array_length(s,1) is distinct from 6 then return false; end if;
  select coalesce(i.max_docs::bigint,
                  public.settings_limit(t.settings, 'maxDocsPerInvite', 25))
    into v_max
    from public.borrower_invites i join public.tenants t on t.id = i.tenant_id
   where i.id::text = s[5];
  if v_max is null then return false; end if;   -- unknown invite → deny
  v_prefix := s[1]||'/deals/'||s[3]||'/borrower-uploads/'||s[5]||'/';
  select count(*) into v_n from storage.objects o
   where o.bucket_id = 'deal-documents' and o.name like v_prefix || '%';
  return v_n < v_max;
end $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.borrower_upload_key_ok(text) FROM public, anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.borrower_object_budget_ok(text) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.borrower_upload_key_ok(text) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.borrower_object_budget_ok(text) TO authenticated;--> statement-breakpoint

-- ── (e) The only two policies a borrower ever matches ───────────────────
-- The (SELECT …) wrapper on the no-argument STABLE function makes the whole
-- borrower branch collapse to a single InitPlan for org users, so this costs
-- staff listings one boolean per statement rather than one per row.
CREATE POLICY "deal_documents_borrower_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deal-documents'
              AND (SELECT public.has_borrower_invite())
              AND public.borrower_upload_key_ok(name)
              AND public.borrower_object_budget_ok(name));--> statement-breakpoint

CREATE POLICY "deal_documents_borrower_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'deal-documents'
         AND (SELECT public.has_borrower_invite())
         AND public.borrower_upload_key_ok(name));--> statement-breakpoint
-- Deliberately NO update/delete policy: borrower objects are immutable,
-- matching 0003's posture for staff uploads.

-- ── (f) Reference-table tightening (A-3) ────────────────────────────────
-- These four were `USING (true)` for any authenticated user — written before
-- a profile-less identity class existed. A borrower must not read the
-- taxonomy, form registry, policy packs or learned mappings. No org
-- behaviour changes: an org user always has a tenant. The worker keeps its
-- own worker_reference_read_* policies.
DROP POLICY IF EXISTS taxonomy_nodes_read ON public.taxonomy_nodes;--> statement-breakpoint
CREATE POLICY taxonomy_nodes_read ON public.taxonomy_nodes FOR SELECT TO authenticated
  USING (public.current_tenant_id() IS NOT NULL);--> statement-breakpoint

DROP POLICY IF EXISTS form_registry_read ON public.form_registry;--> statement-breakpoint
CREATE POLICY form_registry_read ON public.form_registry FOR SELECT TO authenticated
  USING (public.current_tenant_id() IS NOT NULL);--> statement-breakpoint

DROP POLICY IF EXISTS policy_packs_read ON public.policy_packs;--> statement-breakpoint
CREATE POLICY policy_packs_read ON public.policy_packs FOR SELECT TO authenticated
  USING (public.current_tenant_id() IS NOT NULL);--> statement-breakpoint

DROP POLICY IF EXISTS learned_mappings_select ON public.learned_mappings;--> statement-breakpoint
CREATE POLICY learned_mappings_select ON public.learned_mappings FOR SELECT TO authenticated
  USING (public.current_tenant_id() IS NOT NULL
         AND (tenant_id IS NULL OR tenant_id = public.current_tenant_id()));
