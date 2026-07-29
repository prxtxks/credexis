/**
 * Trigger.dev scheduled task `daily-digest` (M11.7) — one email per opted-in
 * user summarizing the notifications they haven't read.
 *
 * Deliberate boundaries:
 * - APPROVAL-CLASS events (identity_review) are excluded: they already mail
 *   immediately from the ingest task. A digest must never be the first time
 *   someone learns an approval is waiting, and nobody gets the same event
 *   twice.
 * - Only UNREAD rows are digested — reading a card in the app is the signal
 *   that the email is unnecessary.
 * - Sending never mutates notification state: the bell stays the source of
 *   truth (Iron Law #5 spirit — email is an advisory copy, not a record).
 * - B4 posture: the service-role client is used with EXPLICIT tenant/
 *   recipient scoping in code; this is a worker, never a request path.
 * - Env-gated: with no RESEND_API_KEY the run logs what it WOULD have sent
 *   and sends nothing.
 */

import { schedules } from "@trigger.dev/sdk";
import * as Sentry from "@sentry/node";
import { createEmailSender, digestEmail } from "@credexis/shared";
import { logEvent, type LogContext } from "../log.js";
import { serviceClient } from "../supabase.js";

/** Kinds that already mail immediately — never repeated in a digest. */
const IMMEDIATE_KINDS = ["identity_review"];

const LOOKBACK_HOURS = 24;

export const dailyDigest = schedules.task({
  id: "daily-digest",
  // 13:00 UTC ≈ start of the US business day; borrowers and bankers both
  // read this with morning coffee rather than overnight.
  cron: "0 13 * * *",
  maxDuration: 300,
  run: async () => {
    const log: LogContext = { task: "daily-digest" };
    const dsn = process.env["SENTRY_DSN"];
    if (dsn) Sentry.init({ dsn, environment: "pipeline", sendDefaultPii: false });

    const client = serviceClient();
    const sender = createEmailSender({
      apiKey: process.env["RESEND_API_KEY"],
      from: process.env["EMAIL_FROM"] ?? "Credexis <notifications@credexis.co>",
    });
    const appUrl = (process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000").replace(
      /\/$/,
      "",
    );
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();

    const { data: rows, error } = await client
      .from("notifications")
      .select("recipient_id, kind, title, body, deal_id, created_at")
      .eq("state", "unread")
      .gte("created_at", since)
      .not("kind", "in", `(${IMMEDIATE_KINDS.join(",")})`)
      .order("created_at", { ascending: false });
    if (error) {
      // A dead query must be loud: a silent digest failure is an invisible
      // outage, exactly the class of bug the M11.5 index postmortem records.
      logEvent(log, "digest-query-failed", { error: error.message.slice(0, 200) });
      Sentry.captureMessage(`daily-digest query failed: ${error.message}`);
      return { recipients: 0, sent: 0 };
    }

    const byRecipient = new Map<string, typeof rows>();
    for (const r of rows ?? []) {
      const id = r.recipient_id as string;
      byRecipient.set(id, [...(byRecipient.get(id) ?? []), r]);
    }
    if (byRecipient.size === 0) {
      logEvent(log, "digest-empty", { lookbackHours: LOOKBACK_HOURS });
      return { recipients: 0, sent: 0 };
    }

    // Recipients must be active AND opted in; resolve emails in one query.
    const { data: profiles } = await client
      .from("profiles")
      .select("id, email, email_notifications, status")
      .in("id", [...byRecipient.keys()])
      .eq("status", "active")
      .eq("email_notifications", true);

    // Deal names make a digest readable; one lookup for every deal referenced.
    const dealIds = [
      ...new Set(
        (rows ?? []).map((r) => r.deal_id as string | null).filter((d): d is string => !!d),
      ),
    ];
    const dealNames = new Map<string, string>();
    if (dealIds.length > 0) {
      const { data: deals } = await client.from("deals").select("id, name").in("id", dealIds);
      for (const d of deals ?? []) dealNames.set(d.id as string, d.name as string);
    }

    let sent = 0;
    for (const p of profiles ?? []) {
      const items = (byRecipient.get(p.id as string) ?? []).map((r) => ({
        title: r.title as string,
        body: (r.body as string | null) ?? null,
        dealName: r.deal_id ? (dealNames.get(r.deal_id as string) ?? null) : null,
      }));
      if (items.length === 0) continue;

      if (!sender.enabled) {
        logEvent(log, "digest-skipped", { reason: "email disabled", items: items.length });
        continue;
      }
      const rendered = digestEmail({ items, appUrl });
      const res = await sender.send({ to: p.email as string, ...rendered });
      if (res.sent) sent++;
      else logEvent(log, "digest-send-failed", { reason: res.reason?.slice(0, 120) ?? "unknown" });
    }

    logEvent(log, "digest-finished", { recipients: (profiles ?? []).length, sent });
    return { recipients: (profiles ?? []).length, sent };
  },
});
