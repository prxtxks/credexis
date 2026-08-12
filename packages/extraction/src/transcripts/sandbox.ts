/**
 * SandboxTranscriptProvider (M19): exercises the ENTIRE transcript flow -
 * consent lifecycle, fetch, ingest, G5 - with deterministic SYNTHETIC
 * data. It exists so the plumbing is integration-tested and demoable
 * before ADR-0003 selects a real IVES provider.
 *
 * Honesty rails:
 * - The provider name "sandbox" is stored on every consent row and shows
 *   verbatim in the UI - synthetic data never masquerades as IRS truth.
 * - Values are a pure hash of (entity ref, year, field): stable across
 *   runs, unrelated to any parsed document. On a demo deal G5 will flag
 *   disagreements - which is the correct behavior to demonstrate, and
 *   the flags say "sandbox" all the way down.
 * - NEVER set TRANSCRIPT_PROVIDER=sandbox in a production environment
 *   with real deals; this is a local/demo configuration.
 */

import type {
  ConsentRequest,
  ConsentStatus,
  TranscriptPayload,
  TranscriptProvider,
} from "./provider.js";

/** FNV-1a - tiny, dependency-free, deterministic. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic cents in a plausible range for the field/year. */
function centsFor(ref: string, year: number, fieldId: string): string {
  const h = fnv1a(`${ref}:${year}:${fieldId}`);
  // 10,000.00 .. ~999,999.99 - round dollars, so the numbers read like
  // transcript lines (the IRS reports whole dollars).
  const dollars = 10_000 + (h % 990_000);
  return String(dollars * 100);
}

/** The lines a sandbox "transcript" carries per family. Registry field
 *  ids only - the ingest path binds taxonomy by identity (Iron Law #4). */
const SANDBOX_LINES: Record<string, string[]> = {
  "1120S": ["f1120s.line1c", "f1120s.line20", "f1120s.line21"],
  "1065": ["f1065.line1c", "f1065.line21", "f1065.line22"],
  "1040": ["f1040.line9", "f1040.line11", "f1040.line24"],
};

export class SandboxTranscriptProvider implements TranscriptProvider {
  readonly name = "sandbox";

  requestConsent(req: ConsentRequest): Promise<ConsentStatus> {
    // Instant-sign: the demo has no borrower in the loop. A real provider
    // returns "sent" with a signUrl and webhooks its way to "signed".
    return Promise.resolve({ externalRef: `sandbox:${req.entityExternalRef}`, status: "signed" });
  }

  getConsentStatus(externalRef: string): Promise<ConsentStatus> {
    return Promise.resolve({ externalRef, status: "signed" });
  }

  fetchTranscripts(externalRef: string, taxYears: number[]): Promise<TranscriptPayload[]> {
    const payloads: TranscriptPayload[] = [];
    for (const taxYear of taxYears) {
      for (const [formFamily, fields] of Object.entries(SANDBOX_LINES)) {
        payloads.push({
          formFamily,
          taxYear,
          lines: fields.map((registryFieldId) => ({
            registryFieldId,
            valueCents: centsFor(externalRef, taxYear, registryFieldId),
          })),
        });
      }
    }
    return Promise.resolve(payloads);
  }
}
