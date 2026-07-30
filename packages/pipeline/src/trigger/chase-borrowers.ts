/**
 * Trigger.dev scheduled task `chase-borrowers` (M12.1 - design 05 §10.5).
 * Once a day: ONE reminder to borrowers who still owe documents, and a sweep
 * flipping past-`expires_at` invites to `expired`.
 *
 * Thin by design - every rule lives in `../borrower-chase.js` as pure
 * functions over plain data, unit-tested without a database. This file
 * queries, calls them, and acts.
 *
 * Deliberate boundaries:
 * - The SWEEP RUNS FIRST and never depends on mail. Reminders are advisory
 *   (email is a copy, the portal is the record), so no send failure may cost
 *   the lifecycle work.
 * - Every failure is LOGGED, including the ones we recover from. A swallowed
 *   error here is an invisible outage - the exact class of bug the M11.5
 *   notification postmortem records.
 * - Env-gated: with no RESEND_API_KEY the run logs what it WOULD send, sends
 *   nothing, and does NOT stamp `last_reminded_at` - the single reminder each
 *   borrower gets must survive an unconfigured environment.
 * - Cadence comes from `tenants.settings` via `resolveChaseCadence`, never a
 *   literal in this file (Advisory 5).
 * - B4 posture: the service-role client is used with EXPLICIT scoping in code
 *   - every follow-up query is keyed by ids taken from the invite rows
 *   themselves, and the recipient address is read off the invite, never
 *   supplied by a caller. This is a worker, never a request path.
 */

import { schedules } from "@trigger.dev/sdk";
import * as Sentry from "@sentry/node";
import { borrowerReminderEmail, createEmailSender } from "@credexis/shared";
import {
  CHASE_CADENCE_DEFAULTS,
  LIVE_INVITE_STATUSES,
  remindersFor,
  resolveChaseCadence,
  selectChaseActions,
  type ChaseCadence,
  type ChaseInvite,
} from "../borrower-chase.js";
import { logEvent, type LogContext } from "../log.js";
import { serviceClient } from "../supabase.js";

/** PostgREST `in` lists travel in the URL; keep every batch comfortably short. */
const ID_CHUNK = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Relative, locale-free expiry wording - the `in N days` convention used by the invite mail. */
function expiresLabel(expiresAt: string, now: Date): string {
  const days = Math.ceil((Date.parse(expiresAt) - now.getTime()) / 86_400_000);
  if (!Number.isFinite(days)) return "soon";
  return days <= 1 ? "tomorrow" : `in ${days} days`;
}

export const chaseBorrowers = schedules.task({
  id: "chase-borrowers",
  // 15:00 UTC ≈ late morning in the US: after the 13:00 digest, so a banker
  // reading their inbox has already seen what arrived overnight, and well
  // inside the borrower's working day.
  cron: "0 15 * * *",
  maxDuration: 300,
  run: async () => {
    const log: LogContext = { task: "chase-borrowers" };
    const dsn = process.env["SENTRY_DSN"];
    if (dsn && !Sentry.isInitialized()) {
      Sentry.init({ dsn, environment: "pipeline", sendDefaultPii: false });
    }
    const now = new Date();
    const client = serviceClient();

    const { data: rows, error } = await client
      .from("borrower_invites")
      .select(
        "id, tenant_id, deal_id, email, display_label, status, portal_status, requested_items, created_at, expires_at, last_reminded_at, revoked_at",
      )
      .in("status", [...LIVE_INVITE_STATUSES]);
    if (error) {
      logEvent(log, "chase-query-failed", { error: error.message.slice(0, 200) });
      Sentry.captureMessage(`chase-borrowers query failed: ${error.message}`);
      return { expired: 0, reminders: 0, sent: 0 };
    }

    const invites: ChaseInvite[] = (rows ?? []).map((r) => ({
      id: r.id as string,
      tenantId: r.tenant_id as string,
      dealId: r.deal_id as string,
      email: r.email as string,
      displayLabel: r.display_label as string,
      status: r.status as string,
      portalStatus: r.portal_status as string,
      requestedItems: r.requested_items,
      createdAt: r.created_at as string,
      expiresAt: r.expires_at as string,
      lastRemindedAt: (r.last_reminded_at as string | null) ?? null,
      revokedAt: (r.revoked_at as string | null) ?? null,
    }));
    if (invites.length === 0) {
      logEvent(log, "chase-empty");
      return { expired: 0, reminders: 0, sent: 0 };
    }

    // Cadence per tenant, resolved from settings (never a literal here).
    const cadenceByTenant = new Map<string, ChaseCadence>();
    for (const ids of chunk([...new Set(invites.map((i) => i.tenantId))], ID_CHUNK)) {
      const { data: tenants, error: cadenceErr } = await client
        .from("tenants")
        .select("id, settings")
        .in("id", ids);
      if (cadenceErr) {
        // Fall back to the default rather than abort: chasing that stops
        // silently is worse than chasing at the standard interval.
        logEvent(log, "chase-cadence-query-failed", { error: cadenceErr.message.slice(0, 200) });
        Sentry.captureMessage(
          `chase-borrowers tenant settings query failed: ${cadenceErr.message}`,
        );
        continue;
      }
      for (const t of tenants ?? []) {
        cadenceByTenant.set(t.id as string, resolveChaseCadence(t.settings));
      }
    }

    const selection = selectChaseActions({
      now,
      invites,
      cadenceFor: (tenantId) => cadenceByTenant.get(tenantId) ?? CHASE_CADENCE_DEFAULTS,
    });
    for (const p of selection.problems) {
      logEvent(log, "chase-invite-skipped", { inviteId: p.inviteId, reason: p.reason });
    }

    /* ── sweep first: lifecycle work owes nothing to email ─────────────── */

    let expired = 0;
    for (const ids of chunk(
      selection.toExpire.map((e) => e.inviteId),
      ID_CHUNK,
    )) {
      const { data: swept, error: sweepErr } = await client
        .from("borrower_invites")
        .update({ status: "expired" })
        .in("id", ids)
        // Re-assert liveness: the 0026 guard RAISES on a transition out of a
        // terminal status, which would abort the whole batch if a row was
        // revoked between the read above and this write.
        .in("status", [...LIVE_INVITE_STATUSES])
        .select("id");
      if (sweepErr) {
        logEvent(log, "chase-sweep-failed", {
          invites: ids.length,
          error: sweepErr.message.slice(0, 200),
        });
        Sentry.captureMessage(`chase-borrowers sweep failed: ${sweepErr.message}`);
        continue;
      }
      expired += swept?.length ?? 0;
    }
    if (selection.toExpire.length > 0) {
      logEvent(log, "chase-sweep-finished", { candidates: selection.toExpire.length, expired });
    }

    /* ── satisfaction: this invite's OWN uploads only (Advisory 3) ─────── */

    const candidateIds = selection.dueForReminder.map((c) => c.invite.id);
    const familiesByInvite = new Map<string, string[]>();
    let satisfactionKnown = true;

    if (candidateIds.length > 0) {
      const inviteByDocument = new Map<string, string>();
      for (const ids of chunk(candidateIds, ID_CHUNK)) {
        const { data: docs, error: docErr } = await client
          .from("documents")
          .select("id, uploaded_via_invite_id")
          .in("uploaded_via_invite_id", ids);
        if (docErr) {
          satisfactionKnown = false;
          logEvent(log, "chase-uploads-query-failed", { error: docErr.message.slice(0, 200) });
          Sentry.captureMessage(`chase-borrowers uploads query failed: ${docErr.message}`);
          break;
        }
        for (const d of docs ?? []) {
          inviteByDocument.set(d.id as string, d.uploaded_via_invite_id as string);
        }
      }
      if (satisfactionKnown) {
        for (const ids of chunk([...inviteByDocument.keys()], ID_CHUNK)) {
          const { data: logicals, error: familyErr } = await client
            .from("logical_documents")
            .select("document_id, form_family")
            .in("document_id", ids);
          if (familyErr) {
            satisfactionKnown = false;
            logEvent(log, "chase-families-query-failed", {
              error: familyErr.message.slice(0, 200),
            });
            Sentry.captureMessage(`chase-borrowers form-family query failed: ${familyErr.message}`);
            break;
          }
          for (const l of logicals ?? []) {
            const inviteId = inviteByDocument.get(l.document_id as string);
            if (inviteId === undefined) continue;
            const seen = familiesByInvite.get(inviteId) ?? [];
            seen.push(l.form_family as string);
            familiesByInvite.set(inviteId, seen);
          }
        }
      }
    }
    if (!satisfactionKnown) {
      // With no satisfaction data every checklist looks untouched, so this run
      // would mail borrowers who already sent everything - and burn the one
      // reminder they get doing it. The sweep above still stands.
      logEvent(log, "chase-reminders-aborted", {
        reason: "satisfaction query failed",
        candidates: candidateIds.length,
      });
      return { expired, reminders: 0, sent: 0 };
    }

    /* ── reminders: advisory, one per invite, failures never fatal ─────── */

    const reminders = remindersFor(selection.dueForReminder, familiesByInvite);
    const sender = createEmailSender({
      apiKey: process.env["RESEND_API_KEY"],
      from: process.env["EMAIL_FROM"] ?? "Credexis <notifications@credexis.co>",
    });
    // NO fallback to the staff app origin. A borrower reminder whose button
    // points at the underwriting app is worse than no reminder: it sends a
    // stranger to a login screen they can never pass, and burns the single
    // reminder this invite will ever get. Unset ⇒ send nothing, loudly.
    const portalUrl = (process.env["NEXT_PUBLIC_PORTAL_URL"] ?? "").replace(/\/$/, "");
    if (portalUrl === "" && sender.enabled) {
      logEvent(log, "chase-portal-url-missing", {
        reminders: reminders.length,
        detail:
          "NEXT_PUBLIC_PORTAL_URL unset; reminders withheld rather than linking to the staff app",
      });
      Sentry.captureMessage("chase-borrowers: NEXT_PUBLIC_PORTAL_URL unset - reminders withheld");
    }

    let sent = 0;
    for (const r of reminders) {
      // Borrower addresses stay out of the logs; the invite id identifies the
      // send completely for support.
      const fields = {
        inviteId: r.inviteId,
        tenantId: r.tenantId,
        dealId: r.dealId,
        items: r.outstandingItems.length,
      };
      if (!sender.enabled) {
        logEvent(log, "chase-reminder-skipped", { ...fields, reason: "email disabled" });
        continue;
      }
      if (portalUrl === "") {
        // Withhold rather than link a borrower into the staff app.
        logEvent(log, "chase-reminder-skipped", { ...fields, reason: "portal url unset" });
        continue;
      }
      try {
        const rendered = borrowerReminderEmail({
          dealLabel: r.displayLabel,
          outstandingItems: r.outstandingItems,
          portalUrl,
          expiresAtLabel: expiresLabel(r.expiresAt, now),
        });
        const res = await sender.send({ to: r.email, ...rendered });
        if (!res.sent) {
          logEvent(log, "chase-reminder-send-failed", {
            ...fields,
            reason: res.reason?.slice(0, 120) ?? "unknown",
          });
          continue;
        }
        sent++;

        const { error: stampErr } = await client
          .from("borrower_invites")
          .update({ last_reminded_at: now.toISOString() })
          .eq("id", r.inviteId)
          .is("last_reminded_at", null);
        if (stampErr) {
          // The mail is out but the record of it is not, so tomorrow's run
          // would send a second one. Loud on purpose.
          logEvent(log, "chase-stamp-failed", {
            ...fields,
            error: stampErr.message.slice(0, 200),
          });
          Sentry.captureMessage(
            `chase-borrowers: reminder sent but last_reminded_at not stamped for invite ${r.inviteId}`,
          );
        }
      } catch (e) {
        // One borrower's failure must never cost the rest of the run.
        logEvent(log, "chase-reminder-errored", {
          ...fields,
          error: (e as Error).message.slice(0, 200),
        });
        Sentry.captureException(e);
      }
    }

    logEvent(log, "chase-finished", { expired, reminders: reminders.length, sent });
    return { expired, reminders: reminders.length, sent };
  },
});
