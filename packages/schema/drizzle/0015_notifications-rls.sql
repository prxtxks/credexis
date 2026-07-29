-- M11.5: notification RLS + fan-out helpers. B1 fix: NO client-reachable
-- insert path — rows are born in SECURITY DEFINER helpers (triggers) or
-- the pipeline's service-role writer. X3 fix: recipients derived from the
-- role lattice at fan-out, never "everyone". Clients may only read their
-- own rows and change state on their own rows.

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY notifications_select_own ON "notifications" FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND recipient_id = auth.uid());--> statement-breakpoint
CREATE POLICY notifications_update_own ON "notifications" FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND recipient_id = auth.uid())
  WITH CHECK (tenant_id = public.current_tenant_id() AND recipient_id = auth.uid());--> statement-breakpoint
-- no INSERT/DELETE policies: function/worker-only writes, retention owns deletes
CREATE INDEX notifications_recipient_state_idx
  ON "notifications" (recipient_id, state, created_at DESC);--> statement-breakpoint
-- Retry-safe dedupe: pipeline retries and repeat events collapse.
CREATE UNIQUE INDEX notifications_recipient_dedupe_uq
  ON "notifications" (recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL;--> statement-breakpoint

-- Fan-out helper: recipients = active members at/above a tier floor.
-- Definer-internal; NOT granted to any client role (B1). action_url is
-- forced app-relative. dedupe_key collapses repeats per recipient.
CREATE OR REPLACE FUNCTION public.notify_tier(
  p_tenant uuid, p_min_tier int, p_kind notification_kind,
  p_title text, p_body text, p_action_url text, p_deal uuid, p_dedupe text
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_count int := 0;
begin
  if p_action_url is not null and p_action_url !~ '^/' then
    raise exception 'action_url must be app-relative';
  end if;
  insert into public.notifications
      (tenant_id, recipient_id, kind, title, body, action_url, deal_id, state, dedupe_key)
  select p_tenant, pr.id, p_kind, p_title, p_body, p_action_url, p_deal, 'unread', p_dedupe
    from public.profiles pr
   where pr.tenant_id = p_tenant and pr.status = 'active'
     and public.role_tier(pr.role) >= p_min_tier
     and (p_dedupe is null or not exists (
            select 1 from public.notifications n
             where n.recipient_id = pr.id and n.dedupe_key = p_dedupe));
  get diagnostics v_count = row_count;
  return v_count;
end
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notify_tier(uuid,int,notification_kind,text,text,text,uuid,text) FROM public, anon, authenticated;--> statement-breakpoint

-- Event: a member joined (invite accepted → profiles INSERT). Notifies
-- admin-tier (>=3). Runs as trigger owner — clients cannot invoke it.
CREATE OR REPLACE FUNCTION public.notify_member_joined() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  if new.role <> 'org_owner' then  -- org bootstrap is not a "join"
    perform public.notify_tier(
      new.tenant_id, 3, 'member_joined',
      coalesce(nullif(new.full_name, ''), new.email) || ' joined the workspace',
      'Role: ' || new.role::text, '/org/members', null,
      'member_joined:' || new.id::text);
  end if;
  return new;
end
$$;--> statement-breakpoint
CREATE TRIGGER profiles_notify_joined AFTER INSERT ON "profiles"
  FOR EACH ROW EXECUTE FUNCTION public.notify_member_joined();
