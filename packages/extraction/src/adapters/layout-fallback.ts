/**
 * Layout fallback chain (M18.4, ADR-0002 addendum): try the primary
 * layout vendor; if it throws, serve from the fallback and SAY SO. Built
 * during the Reducto credit outage, benched against golden-deal P&Ls
 * whose Reducto-derived facts were already in production - Azure's
 * prebuilt-layout transcribed the same tables with exact values, faithful
 * row labels, and cell bboxes.
 *
 * Scope discipline: ADR-0002's Azure demotion was about prebuilt-TAX
 * hallucinating FIELD semantics. Layout transcription is geometry; every
 * interpretation still happens in our own mapping chain behind G1/G2
 * arithmetic gates, and statement facts stay suggested-only regardless of
 * vendor. Field extraction (path 1) remains Reducto-only.
 *
 * Lineage: the returned LayoutParseResult carries the SERVING vendor's
 * own run info, so cost and vendor identity in run rows stay truthful;
 * a failover additionally surfaces in `lastFailover` for run metadata.
 */

import type { DocumentInput, ExtractorAdapter, FieldRequest, LayoutParseResult } from "../types.js";

export interface LayoutFallbackInfo {
  primaryError: string;
  servedBy: string;
}

export class LayoutFallbackAdapter implements ExtractorAdapter {
  readonly name: string;
  readonly version = "1";
  /** Set when the most recent parseLayout was served by the fallback. */
  lastFailover: LayoutFallbackInfo | null = null;

  constructor(
    private readonly primary: ExtractorAdapter,
    private readonly fallback: ExtractorAdapter,
  ) {
    this.name = `${primary.name}→${fallback.name}`;
  }

  async parseLayout(doc: DocumentInput): Promise<LayoutParseResult> {
    this.lastFailover = null;
    try {
      return await this.primary.parseLayout(doc);
    } catch (e) {
      const primaryError = (e as Error).message.slice(0, 200);
      const result = await this.fallback.parseLayout(doc);
      // Only claim the failover AFTER the fallback succeeds - if both die,
      // the thrown error is the fallback's and lastFailover stays null.
      this.lastFailover = { primaryError, servedBy: this.fallback.name };
      return result;
    }
  }

  /** Field extraction never falls back (ADR-0002: no bad reader stands in). */
  extractFields(doc: DocumentInput, fields: FieldRequest[]) {
    return this.primary.extractFields(doc, fields);
  }
}
