-- M12.3 — org_owner can finally WRITE, and the audit log stops out-ranking
-- the tables it audits. Two pre-existing defects, both found by the Tier-1
-- reviewers rather than by a customer.
--
-- (a) THE ORG-OWNER LOCKOUT. 0001 wrote every tenant WRITE policy as
--     current_user_role() in ('admin','underwriter'). `org_owner` did not
--     exist yet — it arrived in 0010 — and no migration ever amended those
--     policies. But create_organization() stamps every org creator
--     'org_owner'. So the person who signs up owns a workspace in which
--     they cannot create a deal, upload a document, edit a fact, or run a
--     scenario. 29 policies across 15 tables plus storage.objects.
--
--     Rewritten to role_tier(...) >= 2 rather than a longer enum list: the
--     tier lattice (0013) is the one place role seniority is defined, so a
--     future role slots in by tier instead of needing 29 more edits. This
--     is exactly the drift that caused the bug.
--
--     Statements below were GENERATED from the live pg_policies definitions
--     and only the role clause substituted, so no predicate is re-typed
--     from memory and nothing else in any policy changes.
ALTER POLICY addbacks_insert ON public.addbacks WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY addbacks_update ON public.addbacks USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2))) WITH CHECK ((tenant_id = current_tenant_id()));--> statement-breakpoint
ALTER POLICY computed_metrics_delete ON public.computed_metrics USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY computed_metrics_insert ON public.computed_metrics WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY deals_insert ON public.deals WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY deals_update ON public.deals USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2))) WITH CHECK ((tenant_id = current_tenant_id()));--> statement-breakpoint
ALTER POLICY documents_insert ON public.documents WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY documents_update ON public.documents USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2))) WITH CHECK ((tenant_id = current_tenant_id()));--> statement-breakpoint
ALTER POLICY entities_insert ON public.entities WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY entities_update ON public.entities USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2))) WITH CHECK ((tenant_id = current_tenant_id()));--> statement-breakpoint
ALTER POLICY extraction_runs_insert ON public.extraction_runs WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY extraction_runs_update ON public.extraction_runs USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2))) WITH CHECK ((tenant_id = current_tenant_id()));--> statement-breakpoint
ALTER POLICY facts_insert ON public.facts WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY facts_update ON public.facts USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2))) WITH CHECK ((tenant_id = current_tenant_id()));--> statement-breakpoint
ALTER POLICY issues_insert ON public.issues WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY issues_update ON public.issues USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2))) WITH CHECK ((tenant_id = current_tenant_id()));--> statement-breakpoint
ALTER POLICY learned_mappings_insert ON public.learned_mappings WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY learned_mappings_update ON public.learned_mappings USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2))) WITH CHECK ((tenant_id = current_tenant_id()));--> statement-breakpoint
ALTER POLICY loan_scenarios_insert ON public.loan_scenarios WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY loan_scenarios_update ON public.loan_scenarios USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2))) WITH CHECK ((tenant_id = current_tenant_id()));--> statement-breakpoint
ALTER POLICY logical_documents_insert ON public.logical_documents WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY logical_documents_update ON public.logical_documents USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2))) WITH CHECK ((tenant_id = current_tenant_id()));--> statement-breakpoint
ALTER POLICY pages_insert ON public.pages WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY pages_update ON public.pages USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2))) WITH CHECK ((tenant_id = current_tenant_id()));--> statement-breakpoint
ALTER POLICY periods_insert ON public.periods WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY periods_update ON public.periods USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2))) WITH CHECK ((tenant_id = current_tenant_id()));--> statement-breakpoint
ALTER POLICY transcript_consents_insert ON public.transcript_consents WITH CHECK (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY transcript_consents_update ON public.transcript_consents USING (((tenant_id = current_tenant_id()) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint
ALTER POLICY deal_documents_tenant_insert ON storage.objects WITH CHECK (((bucket_id = 'deal-documents'::text) AND ((storage.foldername(name))[1] = (current_tenant_id())::text) AND (public.role_tier(public.current_user_role()) >= 2)));--> statement-breakpoint

-- (b) THE AUDIT LOG OUT-RANKED ITS OWN TABLES. audit_log_select (0001) had
--     no role predicate, so any tenant member could read it — while
--     invites_select (0013) requires tier >= 3. The invites audit trigger
--     writes to_jsonb(new) on every invite, so invitee email, granted role,
--     invited_by and token_hash were readable by a viewer who is forbidden
--     the invites table itself. Harmless while nothing rendered audit_log;
--     the audit viewer would have shipped it to a screen.
--
--     Narrowed to admin tier, matching who may read invites in the first
--     place (plan decision D4). The hash chain and verify_audit_chain()
--     are unchanged — this is who may READ history, not whether it is
--     tamper-evident.
DROP POLICY IF EXISTS audit_log_select ON public.audit_log;--> statement-breakpoint
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.role_tier(public.current_user_role()) >= 3);
