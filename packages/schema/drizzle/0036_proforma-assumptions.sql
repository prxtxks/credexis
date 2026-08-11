-- M15: pro-forma assumptions - the EXPLICIT human inputs a projection is
-- computed from (Iron Law #1: nothing invented; the record IS the lineage
-- of every projected number). One active set per deal for the MVP.
CREATE TABLE proforma_assumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  -- Which historical period anchors the projection ("FY2024", a YTD label…).
  base_period_label text NOT NULL,
  months_covered int NOT NULL DEFAULT 12 CHECK (months_covered BETWEEN 1 AND 12),
  -- Per-line treatment overrides: {"is.opex.rent": "fixed", ...}. Absent
  -- keys fall back to the engine's deterministic defaults.
  line_treatments jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Growth per projected year, basis points ([0, 300, 300] = flat, +3%, +3%).
  revenue_growth_bps int[] NOT NULL DEFAULT '{0,0,0}',
  year1_revenue_cents bigint,
  replacement_salary_cents bigint NOT NULL DEFAULT 0,
  updated_by uuid NOT NULL REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id)
);

ALTER TABLE proforma_assumptions ENABLE ROW LEVEL SECURITY;

-- Same tenant-member policy family as sibling deal tables.
CREATE POLICY proforma_assumptions_select ON proforma_assumptions
  FOR SELECT USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY proforma_assumptions_insert ON proforma_assumptions
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('org_owner', 'admin', 'underwriter')
  );
CREATE POLICY proforma_assumptions_update ON proforma_assumptions
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('org_owner', 'admin', 'underwriter')
  );

-- Audit trigger (audit_record, the 0028+ convention): assumptions ARE
-- underwriting decisions - who set them and what changed is the record.
CREATE TRIGGER proforma_assumptions_audit
  AFTER INSERT OR UPDATE OR DELETE ON proforma_assumptions
  FOR EACH ROW EXECUTE FUNCTION public.audit_record();
