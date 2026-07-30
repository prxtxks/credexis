/**
 * Route × role matrix guard (M10.3): every tRPC MUTATION must be built
 * from underwriterProcedure or adminProcedure - viewers read, they never
 * write (Blueprint §11 roles). This scans the real router sources so a
 * new mutation on the wrong tier fails CI, not a pen test.
 *
 * (RLS is the second, DB-level enforcement layer - integration-tested in
 * packages/schema. This test covers the API tier.)
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTERS_DIR = join(__dirname, "routers");

/** procedure-name: builderProcedure ... .mutation( - per chain. */
function mutationTiers(source: string): { name: string; builder: string }[] {
  const out: { name: string; builder: string }[] = [];
  // Split on top-level procedure definitions: `name: builderProcedure`.
  const re = /(\w+):\s*(\w+Procedure)/g;
  const defs: { name: string; builder: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    defs.push({ name: m[1]!, builder: m[2]!, start: m.index });
  }
  for (let i = 0; i < defs.length; i++) {
    const chain = source.slice(defs[i]!.start, defs[i + 1]?.start ?? source.length);
    if (chain.includes(".mutation(")) {
      out.push({ name: defs[i]!.name, builder: defs[i]!.builder });
    }
  }
  return out;
}

describe("tRPC mutation tier matrix (M10.3)", () => {
  const files = readdirSync(ROUTERS_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );

  it("covers the full router surface", () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  /**
   * The designed exceptions (M11.2/M11.3, design 01 §4): org.create and
   * invites.accept both run PRE-PROFILE - the caller cannot hold a role
   * because the mutation is what creates their profile. They are
   * sessionProcedure by necessity; every invariant is enforced inside the
   * create_organization / accept_invite SECURITY DEFINER functions.
   * Anything else appearing here must be treated as a regression.
   */
  const SESSION_TIER_EXCEPTIONS: Record<string, readonly string[]> = {
    "org.ts": ["create", "accept"],
  };

  /**
   * Self-scoped writes (M11.5): notification state changes touch ONLY the
   * caller's own rows (RLS recipient_id = auth.uid()) - legitimately
   * viewer-safe, so protectedProcedure is correct. Nothing here mutates
   * deal data.
   */
  const SELF_SCOPED_EXCEPTIONS: Record<string, readonly string[]> = {
    // archiveAll (ui-18) is the same self-scoped shape as markAllRead:
    // RLS pins the UPDATE to auth.uid()'s own notification rows.
    "notifications.ts": ["setState", "markAllRead", "archiveAll"],
    // profile.update goes through update_own_profile() (SECURITY DEFINER,
    // auth.uid() row only, full_name/email_notifications columns only) -
    // every role may manage their own name and email preference.
    "profile.ts": ["update"],
  };

  for (const file of files) {
    it(`${file}: every mutation is underwriter+ (viewers never write)`, () => {
      const source = readFileSync(join(ROUTERS_DIR, file), "utf8");
      for (const mutation of mutationTiers(source)) {
        if (
          SESSION_TIER_EXCEPTIONS[file]?.includes(mutation.name) &&
          mutation.builder === "sessionProcedure"
        ) {
          continue;
        }
        if (
          SELF_SCOPED_EXCEPTIONS[file]?.includes(mutation.name) &&
          mutation.builder === "protectedProcedure"
        ) {
          continue;
        }
        expect(
          ["underwriterProcedure", "adminProcedure"],
          `${file} → ${mutation.name} is a mutation built from ${mutation.builder}`,
        ).toContain(mutation.builder);
      }
    });
  }
});
