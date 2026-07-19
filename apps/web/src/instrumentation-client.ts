/**
 * Browser-side Sentry (M10.2). Gated on NEXT_PUBLIC_SENTRY_DSN — mirror
 * the DSN under that name (here and in Vercel env) to enable client
 * error capture. No session replay: workspace screens show tax data.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env["NEXT_PUBLIC_SENTRY_DSN"];

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env["NEXT_PUBLIC_VERCEL_ENV"] ?? "development",
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
