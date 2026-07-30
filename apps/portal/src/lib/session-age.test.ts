import { describe, expect, it } from "vitest";
import { MAX_SESSION_AGE_MS, decodeJwtClaims, sessionStartedAtMs } from "./session-age";

/**
 * The absolute session ceiling. The module's own header is honest that this is
 * an app-layer control rather than the real boundary - so these tests pin the
 * one property it genuinely owes: it must not be defeated by ordinary token
 * refresh, which is exactly how an "age" check silently becomes fiction.
 */

/** Build a token with the given claims. Only the payload segment is read. */
function token(claims: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${b64}.signature`;
}

const HOUR = 3600_000;
const nowS = 1_785_000_000; // fixed: no Date.now() in assertions

describe("sessionStartedAtMs - refresh must not reset the clock", () => {
  it("THE POINT: a freshly re-stamped iat does not hide an old sign-in", () => {
    // Supabase re-stamps iat on every hourly refresh. If iat alone won, a
    // borrower could hold a session for weeks and the ceiling would never
    // trip. The older amr timestamp must win.
    const signedInAt = nowS - 20 * 3600; // 20h ago
    const started = sessionStartedAtMs(
      token({ iat: nowS, amr: [{ method: "otp", timestamp: signedInAt }] }),
      null,
    );
    expect(started).toBe(signedInAt * 1000);
    const age = nowS * 1000 - (started as number);
    expect(age).toBeGreaterThan(MAX_SESSION_AGE_MS); // i.e. this session is over
  });

  it("last_sign_in_at also survives refresh and is honoured", () => {
    const signedIn = new Date((nowS - 15 * 3600) * 1000).toISOString();
    const started = sessionStartedAtMs(token({ iat: nowS }), signedIn);
    expect(started).toBe(Date.parse(signedIn));
  });

  it("the OLDEST signal wins - the conservative reading of an ambiguous set", () => {
    const oldest = (nowS - 30 * 3600) * 1000;
    const started = sessionStartedAtMs(
      token({ iat: nowS, amr: [{ method: "otp", timestamp: nowS - 5 * 3600 }] }),
      new Date(oldest).toISOString(),
    );
    expect(started).toBe(oldest);
  });

  it("a fresh sign-in is inside the ceiling", () => {
    const started = sessionStartedAtMs(
      token({ iat: nowS, amr: [{ method: "otp", timestamp: nowS - 2 * 3600 }] }),
      null,
    );
    expect(nowS * 1000 - (started as number)).toBeLessThan(MAX_SESSION_AGE_MS);
  });

  it("returns null when NOTHING is readable - the caller must decide, not guess", () => {
    // Deliberately not 0 (which would read as "epoch, therefore ancient") and
    // not Date.now() (which would read as "brand new"). Either default would
    // be a security decision hidden in a parser.
    expect(sessionStartedAtMs(null, null)).toBeNull();
    expect(sessionStartedAtMs(token({}), null)).toBeNull();
    expect(sessionStartedAtMs("not-a-jwt", null)).toBeNull();
    expect(sessionStartedAtMs(token({ iat: "soon" }), "never")).toBeNull();
  });

  it("ignores non-positive and non-finite timestamps rather than trusting them", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, {}, []]) {
      expect(sessionStartedAtMs(token({ iat: bad }), null), JSON.stringify(bad)).toBeNull();
    }
  });

  it("survives a malformed amr array without throwing", () => {
    const started = sessionStartedAtMs(
      token({
        iat: nowS,
        amr: [null, "otp", 7, { timestamp: "x" }, { timestamp: nowS - HOUR / 1000 }],
      }),
      null,
    );
    expect(started).not.toBeNull();
  });
});

describe("decodeJwtClaims", () => {
  it("reads base64url payloads, including ones needing padding", () => {
    for (const claims of [{ a: 1 }, { ab: 2 }, { abc: 3 }, { sub: "x".repeat(7) }]) {
      expect(decodeJwtClaims(token(claims))).toEqual(claims);
    }
  });

  it("returns null rather than throwing on anything unreadable", () => {
    for (const bad of ["", "onlyone", "a.!!!.c", "a.eyJ.c", "a..c"]) {
      expect(decodeJwtClaims(bad), bad).toBeNull();
    }
  });

  it("returns null for a payload that is valid JSON but not an object", () => {
    const scalar = `h.${Buffer.from("42").toString("base64url")}.s`;
    expect(decodeJwtClaims(scalar)).toBeNull();
  });

  it("does NOT verify - it only decodes", () => {
    // Verification is getUser()'s job against the auth server. This module
    // reads timestamps out of a token already verified; a test asserting
    // otherwise would misrepresent where the trust boundary sits.
    const forged = token({ iat: nowS, sub: "someone-else" });
    expect(decodeJwtClaims(forged)).toMatchObject({ sub: "someone-else" });
  });
});
