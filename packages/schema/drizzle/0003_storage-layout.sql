CREATE UNIQUE INDEX "documents_deal_sha256_unique" ON "documents" USING btree ("deal_id","sha256");
--> statement-breakpoint
-- ============================================================
-- M2.4 Storage layout: private bucket, per-tenant prefixes,
-- size/type limits, tenant-scoped RLS on storage.objects.
--
-- Object key convention (enforced by policy, built by the app):
--   <tenant_id>/deals/<deal_id>/uploads/<sha256>.<ext>
--   <tenant_id>/deals/<deal_id>/pages/<logical_doc_id>/<page>.png
-- The FIRST path segment is always the tenant id — every policy
-- below keys on it. Objects are immutable: no UPDATE policy
-- exists; replacing a file means uploading new bytes (new hash).
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deal-documents',
  'deal-documents',
  false,
  52428800, -- 50 MiB per object
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/tiff',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
--> statement-breakpoint
-- Tenant members read their own tenant's objects (any role incl. viewer).
create policy "deal_documents_tenant_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'deal-documents'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );
--> statement-breakpoint
-- Only admin/underwriter write, and only under their tenant prefix.
create policy "deal_documents_tenant_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'deal-documents'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_role() in ('admin', 'underwriter')
  );
--> statement-breakpoint
-- Delete is admin-only (still tenant-scoped). No UPDATE policy: immutable.
create policy "deal_documents_tenant_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'deal-documents'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_user_role() = 'admin'
  );
--> statement-breakpoint
-- Pipeline worker (M2.2): table-scoped access to this bucket only —
-- reads uploads, writes page renders. Explicit tenant checks live in
-- worker code; the role cannot touch any other bucket.
create policy "deal_documents_worker_select" on storage.objects
  for select to credexis_worker
  using (bucket_id = 'deal-documents');
--> statement-breakpoint
create policy "deal_documents_worker_insert" on storage.objects
  for insert to credexis_worker
  with check (bucket_id = 'deal-documents');
--> statement-breakpoint
-- Policies alone don't grant table access: the worker role needs schema
-- usage + DML grants for its policies above to mean anything.
grant usage on schema storage to credexis_worker;
--> statement-breakpoint
grant select on storage.buckets to credexis_worker;
--> statement-breakpoint
grant select, insert on storage.objects to credexis_worker;
--> statement-breakpoint
-- Let the admin session user (postgres — used by migrations and the RLS
-- integration harness) impersonate the worker role via SET ROLE.
grant credexis_worker to postgres;
