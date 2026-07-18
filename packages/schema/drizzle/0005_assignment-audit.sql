-- M6.5: split/entity assignment decisions join the audited spine. The
-- assignment API mutates logical_documents as the caller (confirm/fix form
-- family, tax year, entity) — the M2.5 trigger mechanism records actor +
-- before/after for every such decision, same as facts (bank requirement).
create trigger logical_documents_audit
  after insert or update or delete on public.logical_documents
  for each row execute function public.audit_record();
