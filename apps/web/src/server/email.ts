/**
 * Server-side email wiring (M11.7). The shared transport is env-gated:
 * without RESEND_API_KEY every send is a visible no-op, so all call sites
 * are live and tested before the key exists. Email is ADVISORY - in-app
 * notifications and one-time links keep working when it is down.
 */

import { createEmailSender, type EmailSender } from "@credexis/shared";

export function emailSender(): EmailSender {
  return createEmailSender({
    apiKey: process.env["RESEND_API_KEY"],
    from: process.env["EMAIL_FROM"] ?? "Credexis <notifications@credexis.co>",
  });
}

/** Absolute base URL for links in emails (emails cannot use relative URLs). */
export function appBaseUrl(): string {
  return (process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000").replace(/\/$/, "");
}
