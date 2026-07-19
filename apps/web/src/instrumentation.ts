/**
 * Server-side Sentry (M10.2). DSN-gated: absent DSN → no-op, the app runs
 * identically. Source-map upload (SENTRY_AUTH_TOKEN + org/project) is a
 * separate, optional step — runtime error capture works without it.
 *
 * PII posture: tax documents carry SSNs/EINs — sendDefaultPii stays OFF
 * and beforeSend strips request bodies; we report errors, never payloads.
 */

import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-scrub";

export async function register(): Promise<void> {
  const dsn = process.env["SENTRY_DSN"];
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env["VERCEL_ENV"] ?? "development",
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubEvent(event);
    },
  });
}

export const onRequestError = Sentry.captureRequestError;
