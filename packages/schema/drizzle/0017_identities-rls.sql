-- M11.6: document_identities RLS. Reads for tenant members; DECIDE
-- (state changes) for underwriter tier and above; INSERT is worker-only
-- (service role — no client insert policy, same posture as facts).
ALTER TABLE "document_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY document_identities_select ON "document_identities" FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());--> statement-breakpoint
CREATE POLICY document_identities_decide ON "document_identities" FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.role_tier(public.current_user_role()) >= 2)
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint
-- schema-check note: worker-visibility mirrors logical_documents; the
-- audit trigger records every decision with its actor.
CREATE TRIGGER document_identities_audit AFTER INSERT OR UPDATE OR DELETE ON "document_identities"
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();
