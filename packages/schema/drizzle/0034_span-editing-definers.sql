-- M13.5 — atomic span editing for the assignment reviewer.
--
-- WHY DEFINERS. Splitting a span is INSERT + UPDATE; merging is UPDATE ×3 +
-- UPDATE + DELETE. Run as separate PostgREST calls they are not atomic: an
-- interruption between statements leaves overlapping page ranges, and the
-- reviewer's screen then lies about which pages belong to which form. One
-- function call is one transaction, so a span edit either happens whole or
-- not at all.
--
-- WHY NOT RELAX RLS. `logical_documents_delete` restricts DELETE to admin,
-- matching the product-wide convention (deals, documents, facts, entities,
-- pages, periods all do the same). Merging is ordinary underwriter review
-- work, so the answer is a narrow definer that performs exactly this one
-- delete after checking authorization itself - not a blanket DELETE grant.
-- Discovered the hard way: the first cut called .delete() from the request
-- path as an underwriter, RLS matched zero rows, and supabase-js reports no
-- error for a zero-row delete. The merge silently left a duplicate
-- overlapping span (memory: silent-failure-discipline).
--
-- SECURITY POSTURE. Both functions are SECURITY DEFINER, so RLS does not
-- protect them - the tenant and role checks below ARE the protection, and
-- every identifier the caller supplies is verified against the caller's own
-- tenant before anything is written. The audit trigger on
-- logical_documents fires for INSERT/UPDATE/DELETE and reads auth.uid(),
-- which is still the human inside a definer, so "every change is audited"
-- keeps holding.

-- ── set page range ──────────────────────────────────────────────────────
-- Facts store source_page LOGICAL-relative (extract-stage.ts), and the
-- source viewer resolves it as `page_start + source_page - 1`. So moving a
-- span's page_start silently relocates the citation of every fact already
-- extracted from it: the underwriter clicks a number and the inspector
-- opens the WRONG page of the PDF - a lineage lie, in the product whose
-- whole wedge is auditability (Iron Law #5). Re-base the children by the
-- same delta in the same transaction so every fact keeps resolving to the
-- physical page it was actually read from.
CREATE OR REPLACE FUNCTION public.set_logical_document_pages(
  p_span uuid, p_start int, p_end int
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
declare v_span record; v_delta int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if public.role_tier(public.current_user_role()) < 2 then
    raise exception 'underwriter role required';
  end if;
  if p_start < 1 or p_end < p_start then
    raise exception 'invalid page range: %-%', p_start, p_end;
  end if;

  select * into v_span from public.logical_documents
   where id = p_span and tenant_id = public.current_tenant_id();
  if v_span.id is null then raise exception 'logical document not found'; end if;

  if exists (
    select 1 from public.logical_documents s
     where s.document_id = v_span.document_id and s.id <> v_span.id
       and p_start <= s.page_end and s.page_start <= p_end
  ) then
    raise exception 'pages %-% overlap an existing span on this file', p_start, p_end;
  end if;

  -- Only `facts.source_page` is an OFFSET into the span (the source
  -- viewer resolves `page_start + source_page - 1`), so only it re-bases.
  -- `pages.page_number` is a sequential 1..N label for the span's own
  -- pages, not an offset - shifting it would corrupt what it means.
  v_delta := p_start - v_span.page_start;
  if v_delta <> 0 then
    update public.facts set source_page = source_page - v_delta
     where source_logical_document_id = v_span.id and source_page is not null;
  end if;

  update public.logical_documents
     set page_start = p_start, page_end = p_end where id = p_span;
end;
$$;

-- ── split ───────────────────────────────────────────────────────────────
-- The original keeps [start, at-1]; a new span takes [at, end] with the
-- same labels and NOTHING confirmed - the reviewer relabels whichever half
-- the splitter got wrong.
CREATE OR REPLACE FUNCTION public.split_logical_document(p_span uuid, p_at_page int)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
declare v_span record; v_new uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if public.role_tier(public.current_user_role()) < 2 then
    raise exception 'underwriter role required';
  end if;

  select * into v_span from public.logical_documents
   where id = p_span and tenant_id = public.current_tenant_id();
  if v_span.id is null then raise exception 'logical document not found'; end if;

  if p_at_page <= v_span.page_start or p_at_page > v_span.page_end then
    raise exception 'split page must be between % and % (got %)',
      v_span.page_start + 1, v_span.page_end, p_at_page;
  end if;

  insert into public.logical_documents
    (tenant_id, document_id, form_family, tax_year, entity_id, entity_confirmed,
     page_start, page_end)
  values
    (v_span.tenant_id, v_span.document_id, v_span.form_family, v_span.tax_year,
     v_span.entity_id, false, p_at_page, v_span.page_end)
  returning id into v_new;

  update public.logical_documents set page_end = p_at_page - 1 where id = p_span;
  return v_new;
end;
$$;

-- ── merge ───────────────────────────────────────────────────────────────
-- Only ADJACENT spans on the same physical file merge: a gap between them
-- would silently swallow pages neither span claimed, and the reviewer
-- should see that gap and decide. The absorbed span's children are
-- re-pointed at the survivor before it is deleted - a fact keeps citing the
-- same physical page and bbox, only the logical grouping (exactly what the
-- reviewer is correcting) moves.
CREATE OR REPLACE FUNCTION public.merge_logical_documents(p_span uuid, p_into uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
declare v_a record; v_b record; v_lower record; v_upper record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if public.role_tier(public.current_user_role()) < 2 then
    raise exception 'underwriter role required';
  end if;
  if p_span = p_into then raise exception 'cannot merge a span with itself'; end if;

  select * into v_a from public.logical_documents
   where id = p_span and tenant_id = public.current_tenant_id();
  select * into v_b from public.logical_documents
   where id = p_into and tenant_id = public.current_tenant_id();
  if v_a.id is null or v_b.id is null then
    raise exception 'logical document not found';
  end if;
  if v_a.document_id <> v_b.document_id then
    raise exception 'spans must belong to the same uploaded file to merge';
  end if;

  if v_a.page_start <= v_b.page_start then
    v_lower := v_a; v_upper := v_b;
  else
    v_lower := v_b; v_upper := v_a;
  end if;
  if v_upper.page_start <> v_lower.page_end + 1 then
    raise exception 'only adjacent spans merge: %-% and %-% are not neighbours',
      v_lower.page_start, v_lower.page_end, v_upper.page_start, v_upper.page_end;
  end if;

  update public.facts set source_logical_document_id = v_lower.id
   where source_logical_document_id = v_upper.id;
  update public.pages set logical_document_id = v_lower.id
   where logical_document_id = v_upper.id;
  update public.document_identities set logical_document_id = v_lower.id
   where logical_document_id = v_upper.id;

  update public.logical_documents
     set page_start = v_lower.page_start, page_end = v_upper.page_end
   where id = v_lower.id;
  delete from public.logical_documents where id = v_upper.id;

  return v_lower.id;
end;
$$;

REVOKE ALL ON FUNCTION public.set_logical_document_pages(uuid, int, int) FROM public, anon;
REVOKE ALL ON FUNCTION public.split_logical_document(uuid, int) FROM public, anon;
REVOKE ALL ON FUNCTION public.merge_logical_documents(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_logical_document_pages(uuid, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_logical_document(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_logical_documents(uuid, uuid) TO authenticated;
