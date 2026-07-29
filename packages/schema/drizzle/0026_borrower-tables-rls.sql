-- M12.1 PR 1 — org-side RLS for the borrower tables.
-- See docs/design/platform/05-borrower-portal.md §§6.2, 6.3.
--
-- SCOPE NOTE: the design put policies in its own PR, but standing order #6
-- (schema-checks) requires every table created in a migration to have RLS
-- AND at least one policy — a table with RLS and no policy is flagged as
-- dead-locked. So the org-side floor ships WITH the DDL, exactly as every
-- prior table pair in this repo did (0010+0011, 0012+0013, …).
--
-- What is deliberately ABSENT: any borrower-reachable policy, helper, or
-- definer. A borrower has no profiles row, so current_tenant_id() is NULL
-- and every policy below is vacuously false for them. The borrower path
-- (storage policies + the four definers) lands in the next PR.

ALTER TABLE "borrower_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- ── borrower_invites: org side only ─────────────────────────────────────
CREATE POLICY borrower_invites_select ON "borrower_invites" FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());--> statement-breakpoint

-- Minting is underwriter+ (tier 2). `deal_id IN (SELECT id FROM deals)` is
-- RLS-filtered, so a broker cannot mint an invite onto another tenant's deal
-- even by guessing its uuid. A freshly minted row is always unclaimed.
CREATE POLICY borrower_invites_insert ON "borrower_invites" FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.role_tier(public.current_user_role()) >= 2
              AND invited_by = auth.uid()
              AND deal_id IN (SELECT id FROM public.deals)
              AND (entity_id IS NULL OR EXISTS (
                    SELECT 1 FROM public.entities e
                     WHERE e.id = entity_id AND e.deal_id = borrower_invites.deal_id))
              AND auth_user_id IS NULL AND claimed_at IS NULL AND status = 'pending'
              AND expires_at > now() AND expires_at < now() + interval '60 days');--> statement-breakpoint

CREATE POLICY borrower_invites_update ON "borrower_invites" FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.role_tier(public.current_user_role()) >= 2)
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint
-- No DELETE policy: append-mostly (revoking stamps revoked_at).

-- RLS cannot restrict COLUMNS, so the grant does. tenant_id, deal_id,
-- entity_id, email, token_hash, auth_user_id and claimed_at are
-- definer-only — a broker must not be able to re-point a live invite at a
-- different deal or hand it to a different auth user.
REVOKE UPDATE ON public.borrower_invites FROM authenticated;--> statement-breakpoint
GRANT UPDATE (status, portal_status, display_label, entity_label, requested_items,
              expires_at, revoked_at, last_reminded_at, max_docs, max_bytes,
              max_cost_micro_usd)
  ON public.borrower_invites TO authenticated;--> statement-breakpoint

-- Transition guard. A GUC flag would be useless here (authenticated can
-- set_config any custom GUC); this keys on a transition only the claim
-- definer can make, because only the table owner may write auth_user_id.
CREATE OR REPLACE FUNCTION public.borrower_invites_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
begin
  if old.status in ('revoked','expired') and new.status <> old.status then
    raise exception 'borrower invite: status is terminal';
  end if;
  if new.status = 'active' and old.status <> 'active'
     and (old.auth_user_id is not null or new.auth_user_id is null) then
    raise exception 'borrower invite: only claim_borrower_invite() activates an invite';
  end if;
  return new;
end $$;--> statement-breakpoint
CREATE TRIGGER borrower_invites_guard BEFORE UPDATE ON "borrower_invites"
  FOR EACH ROW EXECUTE FUNCTION public.borrower_invites_guard();--> statement-breakpoint

-- ── document_requests: org side only ────────────────────────────────────
CREATE POLICY document_requests_select ON "document_requests" FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());--> statement-breakpoint
CREATE POLICY document_requests_insert ON "document_requests" FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.role_tier(public.current_user_role()) >= 2
              AND requested_by = auth.uid()
              AND invite_id IN (SELECT id FROM public.borrower_invites));--> statement-breakpoint
CREATE POLICY document_requests_update ON "document_requests" FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.role_tier(public.current_user_role()) >= 2)
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint

-- ── FK deferred from the generated DDL (same pattern as deals.created_by) ─
ALTER TABLE "document_requests"
  ADD CONSTRAINT document_requests_fulfilled_by_document_id_documents_id_fk
  FOREIGN KEY ("fulfilled_by_document_id") REFERENCES public.documents("id");--> statement-breakpoint

-- ── Audit the whole borrower identity chain (0004 writer, 0024 hash chain) ─
CREATE TRIGGER borrower_invites_audit AFTER INSERT OR UPDATE OR DELETE ON "borrower_invites"
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();--> statement-breakpoint
CREATE TRIGGER document_requests_audit AFTER INSERT OR UPDATE OR DELETE ON "document_requests"
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();
