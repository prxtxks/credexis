-- M12.1 — the two database objects the borrower upload path depends on.
--
-- Written because an implementation attempt CALLED both of these and cited
-- them as its defense-in-depth partner while neither existed (caught in
-- adversarial review, 2026-07-29). Code whose safety argument rests on an
-- imaginary trigger is worse than code with no argument at all, so the
-- objects land FIRST and the worker is rewritten against them.

-- ── (a) Path pinning at the DB layer (design §6.4, attack B2) ───────────
-- A TRIGGER, not a policy, so it binds every writer identically: the
-- client, the definer, the service-role worker and postgres. RLS would
-- bind only the first.
CREATE OR REPLACE FUNCTION public.documents_invite_path_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare inv record; v_ext text;
begin
  -- Lineage columns are immutable for ANY writer. A document that could be
  -- re-pointed after ingest would let a row keep its clean audit history
  -- while its bytes changed underneath.
  if tg_op = 'UPDATE' then
    if new.storage_path is distinct from old.storage_path
       or new.sha256    is distinct from old.sha256
       or new.tenant_id is distinct from old.tenant_id
       or new.deal_id   is distinct from old.deal_id
       or new.uploaded_via_invite_id is distinct from old.uploaded_via_invite_id then
      raise exception 'documents: storage_path/sha256/tenant/deal/invite are immutable';
    end if;
    return new;
  end if;

  if new.uploaded_via_invite_id is null then
    -- An org upload may never sit in the borrower prefix: that prefix is the
    -- only place the borrower storage policies grant, so a staff row parked
    -- there would be readable by whichever borrower owns that folder.
    if new.storage_path like '%/borrower-uploads/%' then
      raise exception 'documents: borrower prefix requires uploaded_via_invite_id';
    end if;
    return new;
  end if;

  select * into inv from public.borrower_invites where id = new.uploaded_via_invite_id;
  if inv.id is null then raise exception 'documents: unknown borrower invite'; end if;
  if new.tenant_id <> inv.tenant_id or new.deal_id <> inv.deal_id then
    raise exception 'documents: borrower row tenant/deal do not match the invite';
  end if;
  if new.uploaded_by is distinct from inv.auth_user_id then
    raise exception 'documents: uploader is not the invite holder';
  end if;

  v_ext := substring(new.storage_path from '\.([a-z]{3,4})$');
  -- ONE equality against a canonically rebuilt key settles element count,
  -- literal segments, traversal (a '..' cannot survive it) and invite
  -- identity at once — and is the same shape the TS builder emits, so the
  -- two cannot drift into disagreeing about which paths are legal.
  if new.storage_path <> inv.tenant_id::text || '/deals/' || inv.deal_id::text
       || '/borrower-uploads/' || inv.id::text || '/' || new.sha256 || '.' || coalesce(v_ext,'')
  then
    raise exception 'documents: storage_path is not pinned to the invite';
  end if;
  return new;
end $$;--> statement-breakpoint
CREATE TRIGGER documents_invite_path_guard BEFORE INSERT OR UPDATE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION public.documents_invite_path_guard();--> statement-breakpoint

-- ── (b) Per-invite extraction spend (design §7.2) ───────────────────────
-- The exact twin of deal_extraction_spend (0022). A SQL aggregate, never a
-- client-side row sum: PostgREST caps responses at 1000 rows, so a client
-- sum silently stops counting on precisely the busiest invites — a ceiling
-- that is weakest where it matters most is not a ceiling.
CREATE OR REPLACE FUNCTION public.invite_extraction_spend(p_invite uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select coalesce(sum(r.cost_micro_usd), 0)::bigint
    from extraction_runs r
    join documents d on d.id = r.document_id
   where d.uploaded_via_invite_id = p_invite
$$;--> statement-breakpoint
-- Worker only. A definer bypasses RLS, so granting this to `authenticated`
-- would let any signed-in user probe another tenant's spend by uuid.
REVOKE ALL ON FUNCTION public.invite_extraction_spend(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.invite_extraction_spend(uuid) TO service_role;
