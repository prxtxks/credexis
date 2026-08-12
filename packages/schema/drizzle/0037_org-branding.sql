-- M17: org-level export branding - the bank's identity on every workbook
-- they hand to a credit committee. One row per tenant; the logo lives in
-- storage and its path is recorded here.
CREATE TABLE org_branding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id),
  display_name text NOT NULL DEFAULT '',
  logo_path text,
  -- Hex colors, validated app-side; header fill + accents in exports.
  primary_color text NOT NULL DEFAULT '#0D7A5F',
  accent_color text NOT NULL DEFAULT '#134E3A',
  footer_text text NOT NULL DEFAULT '',
  updated_by uuid NOT NULL REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_branding_select ON org_branding
  FOR SELECT USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY org_branding_insert ON org_branding
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('org_owner', 'admin')
  );
CREATE POLICY org_branding_update ON org_branding
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('org_owner', 'admin')
  );

CREATE TRIGGER org_branding_audit
  AFTER INSERT OR UPDATE OR DELETE ON org_branding
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();
