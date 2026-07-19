/**
 * TranscriptProvider (M9.2, Blueprint §6): the seam for TaxStatus /
 * Halcyon-class IRS transcript providers. The product is fully functional
 * with NO provider configured (M9.5 graceful absence) — `resolveProvider`
 * returns null until M9.1 ([PRATIK]) selects one and ADR-0003 records it.
 *
 * Values in payloads are integer cents keyed by Form Registry field ids —
 * the ingest path (M9.3) writes them as `method=transcript` facts and the
 * G5 gate does the parsed-vs-transcript comparison.
 */

export interface ConsentRequest {
  entityName: string;
  /** EIN/SSN handling stays inside the provider; we pass a reference only. */
  entityExternalRef: string;
}

export interface ConsentStatus {
  externalRef: string;
  status: "pending" | "sent" | "signed" | "retrieved" | "failed";
  signUrl?: string;
}

export interface TranscriptLine {
  /** Form Registry field id (e.g. "f1120s.line21") — never an ordinal. */
  registryFieldId: string;
  /** Integer cents as string. */
  valueCents: string;
}

export interface TranscriptPayload {
  formFamily: string;
  taxYear: number;
  lines: TranscriptLine[];
}

export interface TranscriptProvider {
  readonly name: string;
  requestConsent(req: ConsentRequest): Promise<ConsentStatus>;
  getConsentStatus(externalRef: string): Promise<ConsentStatus>;
  fetchTranscripts(externalRef: string, taxYears: number[]): Promise<TranscriptPayload[]>;
}

/**
 * Provider registry: keyed by TRANSCRIPT_PROVIDER env. Returns null when
 * unconfigured — callers must treat that as "feature exists, provider
 * pending" and never fail the deal over it.
 */
export function resolveProvider(env: {
  TRANSCRIPT_PROVIDER?: string | undefined;
  TRANSCRIPT_PROVIDER_API_KEY?: string | undefined;
}): TranscriptProvider | null {
  // M9.1 [PRATIK]: TaxStatus vs Halcyon evaluation → ADR-0003 → the chosen
  // adapter registers here. Until then: absent.
  void env;
  return null;
}
