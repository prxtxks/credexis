import { describe, expect, it } from "vitest";
import {
  CHASE_CADENCE_DEFAULTS,
  parseRequestedItems,
  remindersFor,
  resolveChaseCadence,
  selectChaseActions,
  unsatisfiedItems,
  type ChaseInvite,
} from "./borrower-chase.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-07-29T15:00:00.000Z");
const NOW = new Date(T0);
const at = (ms: number): string => new Date(ms).toISOString();

const BUSINESS_RETURNS = {
  key: "business_tax_returns_3y",
  label: "Business tax returns (3y)",
  formFamilies: ["1120", "1120S", "1065"],
};
const PERSONAL_RETURNS = {
  key: "personal_tax_returns",
  label: "Personal tax returns (guarantors)",
  formFamilies: ["1040"],
};

function invite(over: Partial<ChaseInvite> = {}): ChaseInvite {
  return {
    id: "inv-1",
    tenantId: "ten-1",
    dealId: "deal-1",
    email: "borrower@example.com",
    displayLabel: "Sunrise Motel Acquisition",
    status: "active",
    portalStatus: "collecting",
    requestedItems: [BUSINESS_RETURNS, PERSONAL_RETURNS],
    createdAt: at(T0 - 8 * DAY),
    expiresAt: at(T0 + 22 * DAY),
    lastRemindedAt: null,
    revokedAt: null,
    ...over,
  };
}

const defaultCadence = () => CHASE_CADENCE_DEFAULTS;
const select = (invites: ChaseInvite[], cadenceFor = defaultCadence) =>
  selectChaseActions({ now: NOW, invites, cadenceFor });

describe("resolveChaseCadence", () => {
  it("defaults to T+7 when settings are absent or not an object", () => {
    for (const s of [undefined, null, 7, "chase", [], {}, { chase: null }, { chase: [] }]) {
      expect(resolveChaseCadence(s)).toEqual({ reminderAfterDays: 7, expireGraceDays: 14 });
    }
  });

  it("honours a positive integer override", () => {
    expect(resolveChaseCadence({ chase: { reminderAfterDays: 3 } })).toEqual({
      reminderAfterDays: 3,
      expireGraceDays: 14,
    });
    expect(resolveChaseCadence({ chase: { expireGraceDays: 30 } })).toEqual({
      reminderAfterDays: 7,
      expireGraceDays: 30,
    });
  });

  it("malformed overrides fall back to the default and NEVER turn chasing off", () => {
    for (const v of [0, -1, 7.5, "7", true, null, [7], { days: 7 }, Number.NaN, Infinity]) {
      expect(resolveChaseCadence({ chase: { reminderAfterDays: v } }).reminderAfterDays).toBe(7);
    }
  });

  it("rejects a cadence longer than the maximum invite lifetime", () => {
    // 60 days is the ceiling on expires_at (design §4.2); beyond it the
    // reminder could never fire, which would be 'off' by another name.
    expect(resolveChaseCadence({ chase: { reminderAfterDays: 60 } }).reminderAfterDays).toBe(60);
    expect(resolveChaseCadence({ chase: { reminderAfterDays: 61 } }).reminderAfterDays).toBe(7);
    expect(resolveChaseCadence({ chase: { reminderAfterDays: 99999 } }).reminderAfterDays).toBe(7);
  });

  it("ignores the unrelated limits namespace", () => {
    expect(resolveChaseCadence({ limits: { reminderAfterDays: 30 } }).reminderAfterDays).toBe(7);
  });
});

describe("parseRequestedItems", () => {
  it("drops entries that carry nothing a borrower could read", () => {
    expect(
      parseRequestedItems([
        BUSINESS_RETURNS,
        null,
        "1040",
        [],
        { formFamilies: ["1065"] },
        { key: "  ", label: "  " },
        { key: "debt_schedule" },
      ]),
    ).toEqual([
      {
        key: "business_tax_returns_3y",
        label: "Business tax returns (3y)",
        formFamilies: ["1120", "1120S", "1065"],
      },
      // A key with no label is still displayable; a bare family list is not.
      { key: "debt_schedule", label: "debt_schedule", formFamilies: [] },
    ]);
  });

  it("is empty for anything that is not a jsonb array", () => {
    for (const v of [undefined, null, {}, "[]", 3]) expect(parseRequestedItems(v)).toEqual([]);
  });

  it("keeps only string form families", () => {
    expect(
      parseRequestedItems([{ key: "k", label: "L", formFamilies: ["1120", 5, null, " "] }])[0]
        ?.formFamilies,
    ).toEqual(["1120"]);
  });
});

describe("unsatisfiedItems", () => {
  it("matches families case- and whitespace-insensitively", () => {
    expect(unsatisfiedItems([BUSINESS_RETURNS], [" 1120s "])).toEqual([]);
  });

  it("an item with no form families can never be ticked by an upload", () => {
    const item = { key: "misc", label: "Anything else", formFamilies: [] };
    expect(unsatisfiedItems([item], ["1120", "1040"])).toEqual([item]);
  });

  it("returns only what is still outstanding", () => {
    const out = unsatisfiedItems([BUSINESS_RETURNS, PERSONAL_RETURNS], ["1065"]);
    expect(out.map((i) => i.key)).toEqual(["personal_tax_returns"]);
  });
});

describe("selectChaseActions - reminders", () => {
  it("selects a claimed, live, un-reminded invite past the cadence day", () => {
    const s = select([invite()]);
    expect(s.dueForReminder.map((c) => c.invite.id)).toEqual(["inv-1"]);
    expect(s.dueForReminder[0]?.requestedItems).toHaveLength(2);
    expect(s.toExpire).toEqual([]);
    expect(s.problems).toEqual([]);
  });

  it("sends EXACTLY ONE reminder ever - last_reminded_at is the record", () => {
    expect(select([invite({ lastRemindedAt: at(T0 - DAY) })]).dueForReminder).toEqual([]);
  });

  it("leaves an invite alone once the broker marks collection complete", () => {
    expect(select([invite({ portalStatus: "complete" })]).dueForReminder).toEqual([]);
  });

  it("waits for the full cadence window", () => {
    const justShort = invite({ createdAt: at(T0 - 7 * DAY + 3600_000) });
    expect(select([justShort]).dueForReminder).toEqual([]);
    const exactlyDue = invite({ createdAt: at(T0 - 7 * DAY) });
    expect(select([exactlyDue]).dueForReminder).toHaveLength(1);
  });

  it("uses the tenant's cadence, not a literal", () => {
    const young = invite({ createdAt: at(T0 - 3 * DAY) });
    expect(select([young]).dueForReminder).toEqual([]);
    expect(
      select([young], () => ({ reminderAfterDays: 3, expireGraceDays: 14 })).dueForReminder,
    ).toHaveLength(1);
  });

  it("never chases an unclaimed invite - the raw claim token is not stored", () => {
    const pending = invite({ status: "pending" });
    const s = select([pending]);
    expect(s.dueForReminder).toEqual([]);
    expect(s.toExpire).toEqual([]);
  });

  it("ignores terminal invites entirely", () => {
    const s = select([
      invite({ id: "a", status: "revoked" }),
      invite({ id: "b", status: "expired" }),
      invite({ id: "c", revokedAt: at(T0 - DAY) }),
      invite({ id: "d", status: "expired", expiresAt: at(T0 - DAY) }),
    ]);
    expect(s.dueForReminder).toEqual([]);
    expect(s.toExpire).toEqual([]);
    expect(s.problems).toEqual([]);
  });

  it("does not chase an invite whose checklist is empty", () => {
    const s = select([invite({ requestedItems: [] })]);
    expect(s.dueForReminder).toEqual([]);
    expect(s.problems).toEqual([]);
  });

  it("orders candidates oldest-first with a stable tie-break", () => {
    const s = select([
      invite({ id: "b", createdAt: at(T0 - 9 * DAY) }),
      invite({ id: "a", createdAt: at(T0 - 9 * DAY) }),
      invite({ id: "c", createdAt: at(T0 - 30 * DAY) }),
    ]);
    expect(s.dueForReminder.map((c) => c.invite.id)).toEqual(["c", "a", "b"]);
  });
});

describe("selectChaseActions - expiry sweep", () => {
  it("sweeps both pending and claimed invites once the grace window closes", () => {
    const s = select([
      invite({ id: "pending-gone", status: "pending", expiresAt: at(T0 - 15 * DAY) }),
      invite({ id: "active-gone", status: "active", expiresAt: at(T0 - 20 * DAY) }),
    ]);
    expect(s.toExpire.map((e) => e.inviteId)).toEqual(["active-gone", "pending-gone"]);
    expect(s.toExpire[0]).toEqual({
      inviteId: "active-gone",
      tenantId: "ten-1",
      expiresAt: at(T0 - 20 * DAY),
    });
  });

  it("GRACE: a just-lapsed invite is NOT swept, so Extend still works", () => {
    // `expired` is terminal (0026 guard) while extend only bumps expires_at,
    // so sweeping on the day it lapses would silently delete the broker's
    // Extend button - the exact action they reach for when a borrower goes
    // quiet. The borrower still cannot use it: every access path re-checks
    // expires_at > now() per statement.
    for (const days of [0, 1, 13]) {
      const s = select([invite({ expiresAt: at(T0 - days * DAY - 1) })]);
      expect(s.toExpire, `lapsed ${days}d ago`).toEqual([]);
    }
    // …and once the window closes, the row goes terminal so the borrower can
    // be re-invited (borrower_invites_live_uq is partial on pending/active).
    expect(select([invite({ expiresAt: at(T0 - 14 * DAY) })]).toExpire).toHaveLength(1);
  });

  it("expiring and chasing are disjoint - a dead link is never mailed", () => {
    // Otherwise the borrower gets a reminder pointing at a portal they can no
    // longer enter.
    const s = select([invite({ expiresAt: at(T0 - 1) })]);
    expect(s.dueForReminder).toEqual([]);
  });

  it("an invite expiring later today is still live", () => {
    const s = select([invite({ expiresAt: at(T0 + 3600_000) })]);
    expect(s.toExpire).toEqual([]);
    expect(s.dueForReminder).toHaveLength(1);
  });
});

describe("selectChaseActions - problems are surfaced, never swallowed", () => {
  it("reports unreadable timestamps and acts on neither", () => {
    const s = select([
      invite({ id: "bad-expiry", expiresAt: "not a date" }),
      invite({ id: "bad-created", createdAt: "" }),
    ]);
    expect(s.dueForReminder).toEqual([]);
    expect(s.toExpire).toEqual([]);
    expect(s.problems).toEqual([
      { inviteId: "bad-expiry", reason: "unparseable expires_at" },
      { inviteId: "bad-created", reason: "unparseable created_at" },
    ]);
  });

  it("reports a malformed checklist instead of mailing about nothing", () => {
    const s = select([
      invite({ id: "not-array", requestedItems: { business: true } }),
      invite({ id: "unreadable", requestedItems: [null, 42, { formFamilies: ["1120"] }] }),
    ]);
    expect(s.dueForReminder).toEqual([]);
    expect(s.problems).toEqual([
      { inviteId: "not-array", reason: "requested_items is not an array" },
      { inviteId: "unreadable", reason: "requested_items has no readable entries" },
    ]);
  });
});

describe("remindersFor", () => {
  const candidates = select([invite()]).dueForReminder;

  it("lists only the outstanding items, in checklist order", () => {
    const reminders = remindersFor(candidates, new Map([["inv-1", ["1120S"]]]));
    expect(reminders).toEqual([
      {
        inviteId: "inv-1",
        tenantId: "ten-1",
        dealId: "deal-1",
        email: "borrower@example.com",
        displayLabel: "Sunrise Motel Acquisition",
        outstandingItems: ["Personal tax returns (guarantors)"],
        expiresAt: at(T0 + 22 * DAY),
      },
    ]);
  });

  it("says nothing when everything asked for has arrived", () => {
    expect(remindersFor(candidates, new Map([["inv-1", ["1065", "1040"]]]))).toEqual([]);
  });

  it("counts only THIS invite's uploads (Advisory 3 - no deal-composition oracle)", () => {
    // A co-guarantor's or the org's upload of the same family must not tick
    // this borrower's box.
    const reminders = remindersFor(candidates, new Map([["inv-2", ["1120", "1040"]]]));
    expect(reminders[0]?.outstandingItems).toEqual([
      "Business tax returns (3y)",
      "Personal tax returns (guarantors)",
    ]);
  });

  it("treats a missing map entry as 'uploaded nothing'", () => {
    expect(remindersFor(candidates, new Map()).at(0)?.outstandingItems).toHaveLength(2);
  });

  it("carries the snapshot label, never the internal deal name", () => {
    const [reminder] = remindersFor(candidates, new Map());
    expect(reminder?.displayLabel).toBe("Sunrise Motel Acquisition");
  });
});
