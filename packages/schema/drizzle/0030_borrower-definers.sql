-- M12.1 PR3 — the client-reachable definers, and the DISJOINTNESS invariant.
-- docs/design/platform/05-borrower-portal.md §§1.3, 9, 10.3.
--
-- After this migration a borrower can exist. Every function here derives the
-- invite from auth.uid(); the ONLY caller-supplied identifier is p_invite in
-- borrower_attach_upload, and it is verified against auth_user_id = auth.uid()
-- before anything else happens.

-- ── (a) DISJOINTNESS: an auth user is a member XOR a borrower ───────────
-- This is what turns "borrowers reach nothing" from a claim into a proof.
-- Without it a borrower could self-serve a workspace at /welcome and hold
-- both identities, at which point current_tenant_id() stops being NULL for
-- them and every tenant policy opens up.
CREATE OR REPLACE FUNCTION public.claim_borrower_invite(p_token text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
declare v_uid uuid := auth.uid(); v_email text; v_inv record;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'this account belongs to an organization workspace';
  end if;

  select email into v_email from auth.users where id = v_uid;

  -- The token is never stored; only its digest is compared (0013 pattern).
  select * into v_inv from public.borrower_invites
   where token_hash = encode(sha256(convert_to(p_token,'utf8')),'hex')
     and status in ('pending','active') and revoked_at is null and expires_at > now();
  if v_inv.id is null then
    raise exception 'invitation not found, expired, or revoked';
  end if;

  -- The mailbox is the second factor. A leaked link is worthless on its own:
  -- an attacker who signs in as themselves fails here.
  if lower(v_inv.email) <> lower(coalesce(v_email,'')) then
    raise exception 'this invitation was issued to a different email address';
  end if;
  if v_inv.auth_user_id is not null and v_inv.auth_user_id <> v_uid then
    raise exception 'this invitation has already been claimed';
  end if;

  update public.borrower_invites
     set auth_user_id = v_uid, status = 'active', claimed_at = coalesce(claimed_at, now())
   where id = v_inv.id;
  return v_inv.id;   -- idempotent: re-claiming your own invite is a no-op
end $$;--> statement-breakpoint

-- The other half of disjointness: a borrower must never become a member.
-- Both org-side entry points are CREATE OR REPLACE'd with their existing
-- bodies plus one guard each (fetched from the live database so nothing
-- drifts). Without these, a borrower could self-serve a workspace at
-- /welcome, hold both identities, and current_tenant_id() would stop being
-- NULL for them — opening every tenant policy at once.
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
  if exists (select 1 from public.borrower_invites where auth_user_id = v_uid) then
    raise exception 'this account is a borrower-portal account';
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
  if exists (select 1 from public.borrower_invites where auth_user_id = v_uid) then
    raise exception 'this account is a borrower-portal account';
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

-- ── (b) Curated portal state — the ONLY read a borrower ever performs ───
-- Deliberately absent at every layer: metrics, DSCR, facts, issues, gates,
-- add-backs, scenarios, other borrowers' documents, org member names, other
-- deals, audit_log, notifications, the deals row itself.
--
-- `status` is server-derived from borrower-visible facts only and NEVER
-- reads deals.status, so internal pipeline state (intake|parsing|review)
-- cannot leave the database on a borrower call. Item satisfaction counts
-- ONLY this invite's own uploads, so nothing the org or a co-guarantor does
-- moves the borrower's checkboxes.
CREATE OR REPLACE FUNCTION public.borrower_portal_state() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare inv record; v_items jsonb; v_uploads jsonb; v_requests jsonb;
        v_status text; v_open_requests int; v_unsatisfied int; v_processing int;
begin
  select * into inv from public.borrower_invites
   where auth_user_id = auth.uid() and auth.uid() is not null
     and status = 'active' and revoked_at is null and expires_at > now()
   order by created_at desc limit 1;
  if inv.id is null then return null; end if;

  -- Which requested items this invite's OWN uploads have satisfied.
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', it->>'key', 'label', it->>'label',
           'satisfied', exists (
             select 1 from public.documents d
               join public.logical_documents ld on ld.document_id = d.id
              where d.uploaded_via_invite_id = inv.id
                and ld.form_family = any (
                  select jsonb_array_elements_text(coalesce(it->'formFamilies','[]'::jsonb)))))
         ), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(coalesce(inv.requested_items,'[]'::jsonb)) it;

  -- Per-file state is TWO-VALUED on purpose: the borrower learns whether we
  -- could read the file, never whether extraction ran, cost money, or exists.
  select coalesce(jsonb_agg(jsonb_build_object(
           'fileName', d.file_name,
           'uploadedAt', d.created_at,
           'state', case when d.virus_scan in ('infected','failed') or d.status = 'failed'
                         then 'needs_replacement' else 'received' end)
           order by d.created_at desc), '[]'::jsonb)
    into v_uploads
    from public.documents d where d.uploaded_via_invite_id = inv.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'note', r.note, 'createdAt', r.created_at) order by r.created_at), '[]'::jsonb),
         count(*) filter (where r.status = 'open')
    into v_requests, v_open_requests
    from public.document_requests r
   where r.invite_id = inv.id and r.status = 'open';

  select count(*) into v_unsatisfied
    from jsonb_array_elements(v_items) i where (i->>'satisfied')::boolean is not true;
  select count(*) into v_processing
    from public.documents d
   where d.uploaded_via_invite_id = inv.id and d.status in ('uploaded','processing');

  v_status := case
    when inv.portal_status = 'complete' then 'complete'
    when v_open_requests > 0            then 'action_needed'
    when v_unsatisfied > 0              then 'collecting'
    when v_processing > 0               then 'received'
    else 'in_review' end;

  return jsonb_build_object(
    'inviteId', inv.id,
    'label', inv.display_label,          -- snapshot: internal renames stay invisible
    'entityLabel', inv.entity_label,
    'expiresAt', inv.expires_at,
    'status', v_status,
    'items', v_items,
    'uploads', v_uploads,
    'requests', v_requests);
end $$;--> statement-breakpoint

-- ── (c) Attach an uploaded object to a documents row ────────────────────
-- There is no borrower INSERT policy on `documents`, so this is the ONLY
-- way a borrower-originated row is born.
CREATE OR REPLACE FUNCTION public.borrower_attach_upload(
  p_invite uuid, p_sha256 text, p_ext text, p_file_name text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, storage AS $$
declare inv record; v_key text; v_size bigint; v_mime text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bad digest'; end if;
  v_mime := case p_ext
    when 'pdf' then 'application/pdf'  when 'png' then 'image/png'
    when 'jpg' then 'image/jpeg'       when 'tif' then 'image/tiff'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'xls'  then 'application/vnd.ms-excel' end;
  if v_mime is null then raise exception 'unsupported extension'; end if;

  select * into inv from public.borrower_invites
   where id = p_invite and auth_user_id = auth.uid()
     and status = 'active' and revoked_at is null and expires_at > now();
  if inv.id is null then raise exception 'invitation is not active'; end if;

  v_key := inv.tenant_id::text || '/deals/' || inv.deal_id::text
           || '/borrower-uploads/' || inv.id::text || '/' || p_sha256 || '.' || p_ext;

  -- AUTHORITATIVE size, read from the object itself: a caller cannot
  -- understate bytes to slip past a quota. Fails CLOSED if the upload was
  -- never finalized, so a documents row can never point at nothing.
  select (o.metadata->>'size')::bigint into v_size
    from storage.objects o where o.bucket_id = 'deal-documents' and o.name = v_key;
  if v_size is null then raise exception 'upload not finalized for this digest'; end if;

  insert into public.documents (tenant_id, deal_id, file_name, storage_path, sha256,
                                bytes, mime_type, uploaded_by, uploaded_via_invite_id)
  values (inv.tenant_id, inv.deal_id,
          left(regexp_replace(coalesce(p_file_name,'upload'), '[[:cntrl:]/\\]', '', 'g'), 120),
          v_key, p_sha256, v_size::int, v_mime, auth.uid(), inv.id)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then   -- same digest, same invite: idempotent, and no oracle
    select id into v_id from public.documents
     where deal_id = inv.deal_id and sha256 = p_sha256 and uploaded_via_invite_id = inv.id;
  end if;
  return jsonb_build_object('documentId', v_id, 'received', true);
end $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.claim_borrower_invite(text) FROM public, anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.borrower_portal_state() FROM public, anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.borrower_attach_upload(uuid, text, text, text) FROM public, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_borrower_invite(text) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.borrower_portal_state() TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.borrower_attach_upload(uuid, text, text, text) TO authenticated;--> statement-breakpoint

-- ── (d) Borrower uploads enter the audit hash chain with the borrower as actor ─
CREATE TRIGGER documents_borrower_audit AFTER INSERT ON "documents"
  FOR EACH ROW WHEN (new.uploaded_via_invite_id IS NOT NULL)
  EXECUTE FUNCTION public.audit_record();
