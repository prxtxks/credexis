-- M12.1 — the borrower's upload key, derived in SQL.
--
-- The portal must know the object key BEFORE it uploads, but a borrower has
-- no SELECT policy on borrower_invites (by design), so it cannot read its own
-- tenant/deal ids to build one.
--
-- The obvious fix is a definer returning tenant+deal so TypeScript can build
-- the key. This does the better thing and returns the KEY itself: the path
-- grammar then has ONE producer in the whole system, and the TS builder never
-- runs in a request path. Two implementations of a security-relevant string
-- cannot drift when there is only one.
--
-- Deliberately mirrors borrower_upload_key_ok (0029) — same liveness
-- conditions, same segment order — so the producer and the validator agree by
-- construction rather than by test.
CREATE OR REPLACE FUNCTION public.borrower_upload_key(p_sha256 text, p_ext text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare inv record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bad digest'; end if;
  if p_ext !~ '^(pdf|png|jpg|tif|xlsx|xls)$' then raise exception 'unsupported extension'; end if;

  select i.tenant_id, i.deal_id, i.id into inv
    from public.borrower_invites i
   where i.auth_user_id = auth.uid()
     and i.status = 'active' and i.revoked_at is null and i.expires_at > now()
   order by i.created_at desc
   limit 1;
  if inv.id is null then raise exception 'no active invitation'; end if;

  return inv.tenant_id::text || '/deals/' || inv.deal_id::text
         || '/borrower-uploads/' || inv.id::text || '/' || p_sha256 || '.' || p_ext;
end $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.borrower_upload_key(text, text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.borrower_upload_key(text, text) TO authenticated;
