# ADR-0003: IRS transcript provider selection

Status: PROPOSED - [PRATIK] decides after vendor calls. The sandbox
provider (M19) proves the full flow; this ADR picks who supplies real
IRS data.

## Context

G5 is the anti-fraud anchor: parsed return values compared exactly
against the IRS's own transcript of what was filed. Getting transcripts
programmatically requires an IRS-authorized channel - in practice an
IVES (Income Verification Express Service) participant with an API, with
taxpayer consent via Form 8821 (information authorization; preferred
over 4506-C for monitoring use-cases).

The integration seam is already built and provider-agnostic
(`TranscriptProvider`: requestConsent / getConsentStatus /
fetchTranscripts → registry-field-keyed integer cents). The chosen
vendor's adapter registers in `resolveProvider` and everything lights up.

## Candidates (verify current pricing/scope in calls - this table is a

## framework, not gospel)

| Criterion     | TaxStatus                                                            | Halcyon                                                                            |
| ------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Positioning   | API-first IRS data platform; continuous monitoring via standing 8821 | SBA-lending-focused; transcripts + tax-return analysis aimed at 7(a) shops         |
| Consent flow  | 8821 e-sign, ongoing authorization                                   | 8821-based, lender-workflow oriented                                               |
| Fit for us    | Clean API primitives; we build the UX (we already have)              | Speaks SBA natively; may overlap features we've already built                      |
| Risk to check | Per-pull pricing at pilot volume; webhook vs poll                    | Whether their API exposes RAW transcript lines (we need lines, not their analysis) |

## Decision criteria, in order

1. RAW transcript line access via API (we bind by registry field id and
   run our own G5 - a vendor's "analysis" is not a substitute; Iron Law
   #3: our engine computes).
2. 8821 e-sign UX a borrower completes in minutes, with webhook status.
3. Time-to-first-transcript at pilot volume, and pricing per pull.
4. IVES standing + data handling posture (bank buyers will ask).

## Consequences once decided

- Adapter file `packages/extraction/src/transcripts/<vendor>.ts`
  implementing the three methods; register in `resolveProvider`;
  `TRANSCRIPT_PROVIDER=<vendor>` + API key in Vercel (web) env.
- The sandbox provider stays for local/demo/integration tests; it never
  ships enabled in production.
- G5 mismatches become the demo's sharpest moment: "this line differs
  from what the IRS has on file" with both values and lineage.
