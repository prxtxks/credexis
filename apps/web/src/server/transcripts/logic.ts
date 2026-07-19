/**
 * Transcript ingest mapping (M9.3): provider payload → fact rows. Pure.
 *
 * Transcript facts are authoritative source data (Blueprint §6 precedence):
 * method=transcript, accepted on arrival, confidence 1, lineage on
 * source_transcript_line. They never REPLACE parsed facts — both coexist
 * per registry field and the G5 gate flags any disagreement as a tamper
 * signal (critical, blocking).
 */

export interface TranscriptIngestContext {
  tenantId: string;
  dealId: string;
  entityId: string;
  periodId: string;
  taxonomyByRegistryField: Record<string, string | undefined>;
}

export interface TranscriptFactInsert {
  tenant_id: string;
  deal_id: string;
  entity_id: string;
  period_id: string;
  taxonomy_node_key: string | null;
  registry_field_id: string;
  value_cents: string;
  method: "transcript";
  status: "accepted";
  confidence: 1;
  source_transcript_line: string;
}

const INT_RE = /^-?\d+$/;

export function transcriptFactRows(
  lines: { registryFieldId: string; valueCents: string }[],
  ctx: TranscriptIngestContext,
): TranscriptFactInsert[] {
  return lines.map((line) => {
    if (!INT_RE.test(line.valueCents)) {
      throw new Error(`transcript line ${line.registryFieldId}: integer cents required`);
    }
    return {
      tenant_id: ctx.tenantId,
      deal_id: ctx.dealId,
      entity_id: ctx.entityId,
      period_id: ctx.periodId,
      taxonomy_node_key: ctx.taxonomyByRegistryField[line.registryFieldId] ?? null,
      registry_field_id: line.registryFieldId,
      value_cents: line.valueCents,
      method: "transcript",
      status: "accepted",
      confidence: 1,
      source_transcript_line: line.registryFieldId,
    };
  });
}
