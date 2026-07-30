import { describe, expect, it } from "vitest";
import {
  PORTAL_STATUSES,
  STATUS_COPY,
  formatDate,
  parsePortalState,
  type PortalStatus,
} from "./portal-state";

/**
 * This parser is the LAST gate between the database and a borrower's screen.
 * Everything the portal renders comes through it, so its job is not
 * convenience - it is containment. These tests attack it as the leak it would
 * be if it were permissive.
 */
describe("parsePortalState - containment", () => {
  const valid = {
    inviteId: "inv-1",
    label: "Sunrise Motel Acquisition",
    entityLabel: "Sunrise Motel LLC",
    expiresAt: "2026-09-01T00:00:00Z",
    status: "collecting",
    items: [{ key: "business_returns", label: "Business tax returns", satisfied: true }],
    uploads: [{ fileName: "2023.pdf", uploadedAt: "2026-07-01T00:00:00Z", state: "received" }],
    requests: [{ id: "r1", note: "Also the 2024 rent roll please", createdAt: null }],
  };

  it("accepts a well-formed payload unchanged", () => {
    const { invites, malformed } = parsePortalState(valid);
    expect(malformed).toBe(0);
    expect(invites).toHaveLength(1);
    expect(invites[0]?.label).toBe("Sunrise Motel Acquisition");
  });

  it("STRIPS unknown keys - a future definer field cannot leak by being added", () => {
    // The whole containment argument: adding a column to the definer must not
    // be enough to put it on a borrower's screen.
    const leaky = {
      ...valid,
      dscr: "1.42",
      dealStatus: "review",
      cfadsCents: "22500000",
      internalNotes: "thin coverage, second look",
      otherBorrowers: ["jane@example.com"],
    };
    const [parsed] = parsePortalState(leaky).invites;
    expect(parsed).toBeDefined();
    for (const forbidden of [
      "dscr",
      "dealStatus",
      "cfadsCents",
      "internalNotes",
      "otherBorrowers",
    ]) {
      expect(Object.hasOwn(parsed as object, forbidden), forbidden).toBe(false);
    }
    // And nothing internal survives anywhere in the serialised output.
    const serialised = JSON.stringify(parsed);
    for (const leak of ["1.42", "review", "22500000", "thin coverage", "jane@example.com"]) {
      expect(serialised, leak).not.toContain(leak);
    }
  });

  it("coerces an INTERNAL deal status to a curated one - never renders the raw value", () => {
    // deals.status values must never reach a borrower. If one ever does, the
    // borrower sees a safe curated string rather than our pipeline vocabulary.
    for (const internal of ["intake", "parsing", "review", "complete_", "PARSING", ""]) {
      const [parsed] = parsePortalState({ ...valid, status: internal }).invites;
      expect(PORTAL_STATUSES, internal).toContain(parsed?.status);
    }
  });

  it("'complete' is curated too, and must not be confused with the internal one", () => {
    // 'complete' is legitimately in BOTH vocabularies. It passes through, and
    // the copy it maps to is borrower-facing, not pipeline-facing.
    const [parsed] = parsePortalState({ ...valid, status: "complete" }).invites;
    expect(parsed?.status).toBe("complete");
    expect(STATUS_COPY.complete.hint).not.toMatch(/pipeline|extract|parse/i);
  });

  it("every curated status has borrower-facing copy with no jargon", () => {
    for (const s of PORTAL_STATUSES) {
      const copy = STATUS_COPY[s as PortalStatus];
      expect(copy.label.length, s).toBeGreaterThan(0);
      expect(copy.hint.length, s).toBeGreaterThan(0);
      expect(copy.hint, s).not.toMatch(/DSCR|CFADS|extraction|taxonomy|tenant|RLS/i);
    }
  });

  it("a malformed row is COUNTED, not silently dropped", () => {
    // Silence would tell the borrower everything is fine while a document they
    // sent is invisible. The screen says so instead.
    const { invites, malformed } = parsePortalState([valid, { inviteId: 7 }, null]);
    expect(invites).toHaveLength(1);
    expect(malformed).toBe(2);
  });

  it("null/undefined mean 'no invitation', never a crash", () => {
    for (const empty of [null, undefined]) {
      expect(parsePortalState(empty)).toEqual({ invites: [], malformed: 0 });
    }
  });

  it("accepts both a bare object and an array - two deals, same borrower", () => {
    const two = parsePortalState([valid, { ...valid, inviteId: "inv-2" }]);
    expect(two.invites.map((i) => i.inviteId)).toEqual(["inv-1", "inv-2"]);
    expect(parsePortalState(valid).invites).toHaveLength(1);
  });

  it("survives hostile shapes without throwing", () => {
    for (const junk of [0, "", "text", true, [], [[]], { items: "no" }, { uploads: 3 }]) {
      expect(() => parsePortalState(junk), JSON.stringify(junk)).not.toThrow();
    }
  });

  it("a bad nested value degrades that field rather than losing the invite", () => {
    const [parsed] = parsePortalState({
      ...valid,
      items: "not-an-array",
      uploads: "not-an-array",
      requests: "not-an-array",
    }).invites;
    // The invite still renders; the lists come back empty rather than the
    // borrower seeing an error page.
    expect(parsed?.inviteId).toBe("inv-1");
    expect(parsed?.items).toEqual([]);
    expect(parsed?.uploads).toEqual([]);
  });

  it("an unknown upload state falls back to 'received', never leaks processing detail", () => {
    const [parsed] = parsePortalState({
      ...valid,
      uploads: [{ fileName: "x.pdf", state: "extraction_failed_cost_ceiling" }],
    }).invites;
    expect(parsed?.uploads[0]?.state).toBe("received");
  });
});

describe("formatDate", () => {
  it("renders a fixed UTC date so borrower and lender see the same day", () => {
    expect(formatDate("2026-09-01T23:30:00Z")).toBe("Sep 1, 2026");
  });

  it("returns null for anything unparseable rather than 'Invalid Date'", () => {
    for (const bad of [null, undefined, "", "soon", "2026-13-45"]) {
      expect(formatDate(bad), String(bad)).toBeNull();
    }
  });
});
