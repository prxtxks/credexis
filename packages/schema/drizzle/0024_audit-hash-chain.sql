-- M12.3 (bank vendor-security GAP list): audit-log TAMPER EVIDENCE.
--
-- The table was already append-only (UPDATE/DELETE revoked from every role
-- in 0001). That stops the app from rewriting history; it does not prove to
-- an examiner that history was never rewritten by someone with database
-- credentials. A per-tenant hash chain does: every row commits to the row
-- before it, so altering or deleting ANY historical row invalidates every
-- hash after it, and verify_audit_chain() names the first break.
--
-- HONESTY (matters for what this can be claimed to prove): rows written
-- BEFORE this migration are backfilled below so the chain is contiguous and
-- verification needs no special case — but a backfilled hash attests to the
-- row as it exists NOW, not to what was written then. Tamper evidence is
-- meaningful only from this migration forward. Do not describe the earlier
-- period as verified.

-- (a) The canonical content a row commits to. Kept in one function so the
--     insert path and the verifier can never drift apart — the classic way
--     hash chains rot. jsonb::text is deterministic (Postgres normalizes
--     jsonb key order), so equal payloads always hash equally.
CREATE OR REPLACE FUNCTION public.audit_row_payload(
  p_id bigint, p_tenant uuid, p_actor uuid, p_action text,
  p_table text, p_row_id text, p_before jsonb, p_after jsonb, p_created timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  select concat_ws('|',
    p_id::text,
    p_tenant::text,
    coalesce(p_actor::text, ''),
    p_action,
    p_table,
    p_row_id,
    coalesce(p_before::text, ''),
    coalesce(p_after::text, ''),
    -- Fixed ISO format: the default text cast varies with DateStyle, which
    -- would make verification depend on session settings.
    to_char(p_created at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.audit_hash(p_prev text, p_payload text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  select encode(extensions.digest(coalesce(p_prev, '') || p_payload, 'sha256'), 'hex')
$$;--> statement-breakpoint

-- (b) Chain link, assigned at insert. The advisory lock serializes writers
--     within a tenant so two concurrent inserts cannot both claim the same
--     predecessor and fork the chain (the same race the upload-quota trigger
--     had). Different tenants never contend.
CREATE OR REPLACE FUNCTION public.audit_chain_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
declare
  v_prev text;
begin
  perform pg_advisory_xact_lock(hashtextextended('audit:' || new.tenant_id::text, 0));

  select row_hash into v_prev
    from audit_log
   where tenant_id = new.tenant_id
   order by id desc
   limit 1;

  new.prev_hash := v_prev;
  new.row_hash := public.audit_hash(
    v_prev,
    public.audit_row_payload(new.id, new.tenant_id, new.actor_id, new.action,
                             new.table_name, new.row_id, new.before, new.after,
                             new.created_at)
  );
  return new;
end;
$$;--> statement-breakpoint
CREATE TRIGGER audit_log_chain BEFORE INSERT ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION public.audit_chain_link();--> statement-breakpoint

-- (c) Backfill existing rows in chain order, per tenant (see HONESTY above).
DO $$
declare
  r record;
  v_prev text;
  v_tenant uuid;
begin
  v_tenant := null;
  for r in
    select id, tenant_id, actor_id, action, table_name, row_id, before, after, created_at
      from audit_log
     order by tenant_id, id
  loop
    if v_tenant is distinct from r.tenant_id then
      v_tenant := r.tenant_id;
      v_prev := null;
    end if;
    update audit_log
       set prev_hash = v_prev,
           row_hash = public.audit_hash(
             v_prev,
             public.audit_row_payload(r.id, r.tenant_id, r.actor_id, r.action,
                                      r.table_name, r.row_id, r.before, r.after,
                                      r.created_at))
     where id = r.id;
    select row_hash into v_prev from audit_log where id = r.id;
  end loop;
end $$;--> statement-breakpoint

-- (d) Verification. SECURITY INVOKER on purpose: RLS decides which rows the
--     caller may see, and a caller can only verify a tenant whose rows they
--     can already read — so this adds no read surface. Returns the first
--     broken link (empty result = chain intact).
CREATE OR REPLACE FUNCTION public.verify_audit_chain(p_tenant uuid)
RETURNS TABLE(broken_at bigint, reason text)
LANGUAGE plpgsql STABLE AS $$
declare
  r record;
  v_prev text := null;
  v_expected text;
begin
  for r in
    select id, tenant_id, actor_id, action, table_name, row_id, before, after,
           created_at, prev_hash, row_hash
      from audit_log
     where tenant_id = p_tenant
     order by id
  loop
    if r.prev_hash is distinct from v_prev then
      broken_at := r.id;
      reason := 'prev_hash does not match the preceding row (a row was altered or removed)';
      return next;
      return;
    end if;
    v_expected := public.audit_hash(
      v_prev,
      public.audit_row_payload(r.id, r.tenant_id, r.actor_id, r.action,
                               r.table_name, r.row_id, r.before, r.after, r.created_at));
    if r.row_hash is distinct from v_expected then
      broken_at := r.id;
      reason := 'row_hash does not match this row''s content (the row was altered)';
      return next;
      return;
    end if;
    v_prev := r.row_hash;
  end loop;
  return;
end;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.verify_audit_chain(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.verify_audit_chain(uuid) TO authenticated, service_role;
