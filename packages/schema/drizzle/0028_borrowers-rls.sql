-- M12.1 — RLS for `borrowers`, the durable borrower identity.
-- Org side only, same posture as 0026: a borrower has no profiles row, so
-- current_tenant_id() is NULL and every policy here is vacuously false for
-- them. Borrowers never read this table; the portal reads only the four
-- definers.

ALTER TABLE "borrowers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY borrowers_select ON "borrowers" FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());--> statement-breakpoint

-- Adding a borrower is underwriter+ (tier 2) — the same floor as minting an
-- invite, since the two are one workflow from the broker's side.
CREATE POLICY borrowers_insert ON "borrowers" FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.role_tier(public.current_user_role()) >= 2
              AND created_by = auth.uid()
              AND length(btrim(full_name)) > 0
              AND position('@' in email) > 1);--> statement-breakpoint

CREATE POLICY borrowers_update ON "borrowers" FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.role_tier(public.current_user_role()) >= 2)
  WITH CHECK (tenant_id = public.current_tenant_id());--> statement-breakpoint
-- No DELETE policy: a borrower with deal history is never erased from under
-- an audit trail. Retention/erasure is a policy decision (GAP-5), handled
-- deliberately, not by an ad-hoc delete.

-- RLS cannot restrict columns. Contact details are correctable; tenancy and
-- provenance are not.
REVOKE UPDATE ON public.borrowers FROM authenticated;--> statement-breakpoint
GRANT UPDATE (full_name, email, phone, updated_at) ON public.borrowers TO authenticated;--> statement-breakpoint

-- Correcting a borrower's email must not silently re-target a live claim
-- link: `borrower_invites.email` is the address a token was bound to, and
-- `claim_borrower_invite()` binds on email equality. Re-targeting requires
-- revoking and re-minting, which is visible in the audit trail.
CREATE OR REPLACE FUNCTION public.borrowers_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
begin
  if lower(new.email) is distinct from lower(old.email)
     and exists (select 1 from public.borrower_invites bi
                  where bi.borrower_id = old.id
                    and bi.status in ('pending','active')) then
    raise exception
      'borrower has a live invite bound to %; revoke it before changing the email',
      old.email;
  end if;
  new.updated_at := now();
  return new;
end $$;--> statement-breakpoint
CREATE TRIGGER borrowers_guard BEFORE UPDATE ON "borrowers"
  FOR EACH ROW EXECUTE FUNCTION public.borrowers_guard();--> statement-breakpoint

CREATE TRIGGER borrowers_audit AFTER INSERT OR UPDATE OR DELETE ON "borrowers"
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();
