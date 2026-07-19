/**
 * Trigger.dev task `ingest-document` — the id the upload route's
 * trigger-client posts to (apps/web/src/server/pipeline/trigger-client.ts).
 * Thin binding only: all logic lives in runIngest, which is unit-tested
 * against fakes; this file just assembles real deps.
 */

import { task } from "@trigger.dev/sdk";
import * as Sentry from "@sentry/node";
import { z } from "zod";
import { AnthropicPageClassifier } from "@credexis/extraction";
import { runIngest, type IngestResult } from "../ingest.js";
import { logEvent } from "../log.js";
import { serviceClient, supabaseDb, supabaseStorage } from "../supabase.js";

const payloadSchema = z.object({
  documentId: z.string().uuid(),
  tenantId: z.string().uuid(),
  dealId: z.string().uuid(),
});

export const ingestDocument = task({
  id: "ingest-document",
  maxDuration: 600,
  retry: { maxAttempts: 3 },
  run: async (rawPayload: unknown, { ctx }): Promise<IngestResult> => {
    const payload = payloadSchema.parse(rawPayload);
    const log = {
      task: "ingest-document",
      runId: ctx.run.id,
      documentId: payload.documentId,
      dealId: payload.dealId,
    };
    logEvent(log, "started");

    const dsn = process.env["SENTRY_DSN"];
    if (dsn && !Sentry.isInitialized()) {
      Sentry.init({ dsn, environment: "pipeline", sendDefaultPii: false });
    }

    const client = serviceClient();
    const anthropicKey = process.env["ANTHROPIC_API_KEY"];
    const llmUsage: { model: string; inputTokens: number; outputTokens: number }[] = [];

    // No key → deterministic-only classification; unresolved pages land in
    // the review queue instead of being guessed (Iron Law #1).
    const classifier = anthropicKey
      ? new AnthropicPageClassifier({ apiKey: anthropicKey, onUsage: (u) => llmUsage.push(u) })
      : null;

    try {
      const result = await runIngest(
        {
          db: supabaseDb(client),
          storage: supabaseStorage(client),
          // Virus-scan engine not wired yet: virus_scan stays "pending"
          // (ports.ts documents the seam; stamping "clean" would be a lie).
          scanner: null,
          classifier,
          takeLlmUsage: () => llmUsage.splice(0),
        },
        payload,
      );
      logEvent(log, "finished", {
        status: result.status,
        logicalDocuments: result.logicalDocuments.length,
        virusScan: result.virusScan,
        ...(result.reason ? { reason: result.reason } : {}),
      });
      if (result.status === "failed") Sentry.captureMessage(`ingest failed: ${result.reason}`);
      return result;
    } catch (e) {
      logEvent(log, "errored", { error: (e as Error).message });
      Sentry.captureException(e);
      throw e; // Trigger.dev retry policy owns the retry
    }
  },
});
