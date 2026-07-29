/**
 * Borrower chasing (M12.1 — design 05 §10.5): PURE selection logic.
 *
 * Every function here is total and takes plain data — no Supabase client, no
 * network, no clock of its own (`now` is always injected). The Trigger.dev
 * binding in `trigger/chase-borrowers.ts` queries, calls these, and acts. That
 * split is the point: a once-a-day job that emails real borrowers must be
 * provable without a database.
 *
 * The rules that matter, and why:
 *  - EXACTLY ONE reminder per invite, ever. `last_reminded_at` is the record
 *    that it happened, so an invite carrying one is never selected again.
 *  - Reminders and the expiry sweep are DISJOINT. An invite past `expires_at`
 *    is swept, never chased: its link is already dead, so mailing it would
 *    send the borrower somewhere they cannot get in.
 *  - Only a CLAIMED (`active`) invite is chased. The raw invite token is never
 *    stored — only its sha256 (design §3.3) — so no worker can rebuild a
 *    working `/claim?token=` link for a `pending` one. Re-inviting mints a
 *    fresh token and is a broker action in `/deals/[dealId]/borrower`.
 *  - Item satisfaction is computed ONLY over the invite's OWN uploads
 *    (Advisory 3), which is also why the caller passes families per invite id.
 */

/** `borrower_invite_status` values that are still live. Terminal: revoked, expired. */
export const LIVE_INVITE_STATUSES = ["pending", "active"] as const;

const MS_PER_DAY = 86_400_000;

/* ── cadence (tenants.settings, never a literal — Advisory 5) ─────────── */

export interface ChaseCadence {
  /** Days after the invite was minted before its single reminder falls due. */
  reminderAfterDays: number;
  /**
   * Days AFTER `expires_at` before an invite is stamped `expired`.
   *
   * Why a grace window exists at all: `expired` is TERMINAL (the 0026 guard
   * refuses any transition out of it), while `borrowerInvites.extend` only
   * bumps `expires_at`. Sweeping the instant an invite lapses would therefore
   * silently destroy the broker's Extend button — the exact action they reach
   * for when a borrower goes quiet. But the sweep cannot simply be dropped:
   * `borrower_invites_live_uq` is partial on ('pending','active'), so a stale
   * live row BLOCKS re-inviting that borrower on that deal.
   *
   * The window resolves both: extend works while a broker would plausibly use
   * it, and afterwards the row goes terminal so a fresh invite can be minted.
   */
  expireGraceDays: number;
}

/** Pre-pilot cadence: one reminder at T+7 (design decision D-8). */
export const CHASE_CADENCE_DEFAULTS: ChaseCadence = {
  reminderAfterDays: 7,
  expireGraceDays: 14,
};

/**
 * An invite lives at most 60 days (design §4.2), so a cadence beyond that
 * could never fire — a silent "chasing off" switch wearing a number's
 * clothes. Out-of-range values are therefore malformed, not honoured.
 */
const MAX_REMINDER_AFTER_DAYS = 60;

/**
 * A grace window longer than this would leave lapsed invites live for months,
 * blocking re-invitation via the partial unique index. Out of range is
 * malformed, not honoured.
 */
const MAX_EXPIRE_GRACE_DAYS = 90;

function positiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

function objectAt(source: unknown, key: string): Record<string, unknown> {
  const parent =
    typeof source === "object" && source !== null && !Array.isArray(source)
      ? (source as Record<string, unknown>)[key]
      : null;
  return typeof parent === "object" && parent !== null && !Array.isArray(parent)
    ? (parent as Record<string, unknown>)
    : {};
}

/**
 * Resolve the chase cadence from a `tenants.settings` jsonb value, reading
 * `settings.chase.reminderAfterDays`. Same discipline as `resolveDealLimits`
 * in `@credexis/shared`: jsonb NUMBER only, positive integers, malformed or
 * absent → default, NEVER off. A corrupt settings blob must not silently stop
 * a lender chasing their borrowers.
 *
 * Unlike the limits parser this one has NO SQL mirror — cadence is read by
 * this worker alone, so there is no "change both places" rule attached to it.
 */
export function resolveChaseCadence(settings: unknown): ChaseCadence {
  const chase = objectAt(settings, "chase");
  const days = positiveInt(chase["reminderAfterDays"]);
  const grace = positiveInt(chase["expireGraceDays"]);
  return {
    reminderAfterDays:
      days !== null && days <= MAX_REMINDER_AFTER_DAYS
        ? days
        : CHASE_CADENCE_DEFAULTS.reminderAfterDays,
    expireGraceDays:
      grace !== null && grace <= MAX_EXPIRE_GRACE_DAYS
        ? grace
        : CHASE_CADENCE_DEFAULTS.expireGraceDays,
  };
}

/* ── inputs ───────────────────────────────────────────────────────────── */

/**
 * A `borrower_invites` row, flattened to plain data. Timestamps arrive as the
 * ISO strings PostgREST returns; `requestedItems` arrives as raw jsonb because
 * the column is broker-editable and the database constrains nothing about its
 * shape.
 */
export interface ChaseInvite {
  id: string;
  tenantId: string;
  dealId: string;
  /** The address the token was bound to at mint time — never a caller input. */
  email: string;
  /** Snapshot label; the portal and its emails never show `deals.name`. */
  displayLabel: string;
  status: string;
  portalStatus: string;
  requestedItems: unknown;
  createdAt: string;
  expiresAt: string;
  lastRemindedAt: string | null;
  revokedAt: string | null;
}

/**
 * A validated `requested_items` entry — the parsed view of the schema's
 * `RequestedItem`, kept separate because jsonb from a broker-editable column
 * is untrusted input, not a typed row.
 */
export interface RequestedItemSnapshot {
  key: string | null;
  /** What the borrower reads. Never empty. */
  label: string;
  /** Form families that satisfy this item; any match counts. */
  formFamilies: string[];
}

/* ── outputs ──────────────────────────────────────────────────────────── */

export interface ChaseCandidate {
  invite: ChaseInvite;
  requestedItems: RequestedItemSnapshot[];
}

export interface ChaseExpiry {
  inviteId: string;
  tenantId: string;
  expiresAt: string;
}

/** An invite that could not be judged. The binding LOGS these; none is dropped. */
export interface ChaseProblem {
  inviteId: string;
  reason: string;
}

export interface ChaseSelection {
  /** Claimed, live, un-reminded invites that are past their cadence day. */
  dueForReminder: ChaseCandidate[];
  toExpire: ChaseExpiry[];
  problems: ChaseProblem[];
}

export interface ChaseReminder {
  inviteId: string;
  tenantId: string;
  dealId: string;
  email: string;
  displayLabel: string;
  /** Borrower-facing labels still outstanding. Always at least one. */
  outstandingItems: string[];
  expiresAt: string;
}

/* ── parsing helpers ──────────────────────────────────────────────────── */

function parseInstant(value: string | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Form families are compared case- and whitespace-insensitively: the checklist
 * side is a broker-editable snapshot, the upload side is
 * `logical_documents.form_family` written by the classifier. Neither is a
 * controlled vocabulary at the database level.
 */
function normalizeFamily(value: string): string {
  return value.trim().toUpperCase();
}

/** Tolerant parse of the `requested_items` jsonb. Junk entries are dropped, never guessed at. */
export function parseRequestedItems(value: unknown): RequestedItemSnapshot[] {
  if (!Array.isArray(value)) return [];
  const out: RequestedItemSnapshot[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const key = typeof row["key"] === "string" ? row["key"].trim() : "";
    const label = typeof row["label"] === "string" ? row["label"].trim() : "";
    // An entry the borrower could not read is not a checklist line.
    const display = label !== "" ? label : key;
    if (display === "") continue;
    const families = Array.isArray(row["formFamilies"])
      ? row["formFamilies"].filter((f): f is string => typeof f === "string" && f.trim() !== "")
      : [];
    out.push({ key: key !== "" ? key : null, label: display, formFamilies: families });
  }
  return out;
}

/**
 * Items NOT satisfied by this invite's own uploads.
 *
 * An item with no form families can never be ticked by an upload, so it stays
 * outstanding — acceptable because the blast radius of a wrong answer is one
 * email in the invite's entire lifetime.
 */
export function unsatisfiedItems(
  items: readonly RequestedItemSnapshot[],
  uploadedFormFamilies: readonly string[],
): RequestedItemSnapshot[] {
  const seen = new Set(
    uploadedFormFamilies.map(normalizeFamily).filter((f: string) => f.length > 0),
  );
  return items.filter((i) => !i.formFamilies.some((f) => seen.has(normalizeFamily(f))));
}

/* ── selection ────────────────────────────────────────────────────────── */

export interface SelectChaseInput {
  now: Date;
  invites: readonly ChaseInvite[];
  /** Per-tenant cadence; the binding resolves it from `tenants.settings`. */
  cadenceFor: (tenantId: string) => ChaseCadence;
}

/**
 * Decide, for one run, which invites expire and which are due their single
 * reminder. Checklist satisfaction is deliberately NOT decided here: it needs
 * a second query, and only the shortlist this returns is worth running it for.
 *
 * Results are ordered oldest-first so a run cut short by `maxDuration` has
 * served the most overdue borrowers, and so the output is deterministic.
 */
export function selectChaseActions(input: SelectChaseInput): ChaseSelection {
  const nowMs = input.now.getTime();
  const due: { sort: number; value: ChaseCandidate }[] = [];
  const expiring: { sort: number; value: ChaseExpiry }[] = [];
  const problems: ChaseProblem[] = [];

  for (const invite of input.invites) {
    // Terminal rows are nobody's business: revocation and expiry are final.
    if (invite.revokedAt !== null) continue;
    if (!(LIVE_INVITE_STATUSES as readonly string[]).includes(invite.status)) continue;

    const expiresAt = parseInstant(invite.expiresAt);
    if (expiresAt === null) {
      // Never sweep or chase on a date that cannot be read.
      problems.push({ inviteId: invite.id, reason: "unparseable expires_at" });
      continue;
    }
    if (expiresAt <= nowMs) {
      // Lapsed, but only stamped terminal once the grace window closes — see
      // `expireGraceDays`. Until then the row stays live so Extend still works;
      // it is already unusable to the borrower, because every access path
      // re-checks `expires_at > now()` on each statement.
      const graceMs = input.cadenceFor(invite.tenantId).expireGraceDays * MS_PER_DAY;
      if (nowMs - expiresAt >= graceMs) {
        expiring.push({
          sort: expiresAt,
          value: { inviteId: invite.id, tenantId: invite.tenantId, expiresAt: invite.expiresAt },
        });
      }
      continue;
    }

    // Only a claimed invite can be chased — see the header note on tokens.
    if (invite.status !== "active") continue;
    if (invite.lastRemindedAt !== null) continue;
    if (invite.portalStatus === "complete") continue;

    const createdAt = parseInstant(invite.createdAt);
    if (createdAt === null) {
      problems.push({ inviteId: invite.id, reason: "unparseable created_at" });
      continue;
    }
    const cadence = input.cadenceFor(invite.tenantId);
    if (Math.floor((nowMs - createdAt) / MS_PER_DAY) < cadence.reminderAfterDays) continue;

    if (!Array.isArray(invite.requestedItems)) {
      problems.push({ inviteId: invite.id, reason: "requested_items is not an array" });
      continue;
    }
    const requestedItems = parseRequestedItems(invite.requestedItems);
    if (invite.requestedItems.length > 0 && requestedItems.length === 0) {
      problems.push({ inviteId: invite.id, reason: "requested_items has no readable entries" });
      continue;
    }
    // Nothing was asked for, so there is nothing to chase about.
    if (requestedItems.length === 0) continue;

    due.push({ sort: createdAt, value: { invite, requestedItems } });
  }

  // Id is the tie-break so two invites minted in the same millisecond still
  // come out in a fixed order.
  due.sort((a, b) => a.sort - b.sort || a.value.invite.id.localeCompare(b.value.invite.id));
  expiring.sort((a, b) => a.sort - b.sort || a.value.inviteId.localeCompare(b.value.inviteId));

  return {
    dueForReminder: due.map((d) => d.value),
    toExpire: expiring.map((e) => e.value),
    problems,
  };
}

/**
 * Turn the shortlist into the reminders actually worth sending.
 *
 * `uploadedFormFamilies` maps invite id → the `form_family` values of THAT
 * invite's own uploads; a missing entry means "this invite has uploaded
 * nothing". The caller must therefore abort rather than pass a partial map
 * when its query failed — an empty map makes every checklist look untouched
 * and would mail borrowers who already sent everything, burning the one
 * reminder they get.
 */
export function remindersFor(
  candidates: readonly ChaseCandidate[],
  uploadedFormFamilies: ReadonlyMap<string, readonly string[]>,
): ChaseReminder[] {
  const out: ChaseReminder[] = [];
  for (const c of candidates) {
    const outstanding = unsatisfiedItems(
      c.requestedItems,
      uploadedFormFamilies.get(c.invite.id) ?? [],
    );
    if (outstanding.length === 0) continue;
    out.push({
      inviteId: c.invite.id,
      tenantId: c.invite.tenantId,
      dealId: c.invite.dealId,
      email: c.invite.email,
      displayLabel: c.invite.displayLabel,
      outstandingItems: outstanding.map((i) => i.label),
      expiresAt: c.invite.expiresAt,
    });
  }
  return out;
}
