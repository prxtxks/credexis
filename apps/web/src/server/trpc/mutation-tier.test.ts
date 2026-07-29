/**
 * Route × role matrix guard (M10.3): every tRPC MUTATION must be built
 * from underwriterProcedure or adminProcedure — viewers read, they never
 * write (Blueprint §11 roles). This scans the real router sources so a
 * new mutation on the wrong tier fails CI, not a pen test.
 *
 * (RLS is the second, DB-level enforcement layer — integration-tested in
 * packages/schema. This test covers the API tier.)
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTERS_DIR = join(__dirname, "routers");

/** procedure-name: builderProcedure ... .mutation( — per chain. */
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
   * The ONE designed exception (M11.2, design 01 §4.1): org.create runs
   * pre-profile — the caller cannot hold a role because the mutation
   * creates the first profile. It is sessionProcedure by necessity; every
   * invariant (authenticated, profile-less, atomic, caller→org_owner) is
   * enforced inside the create_organization SECURITY DEFINER function.
   * Anything else appearing here must be treated as a regression.
   */
  const SESSION_TIER_EXCEPTIONS: Record<string, readonly string[]> = {
    "org.ts": ["create"],
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
        expect(
          ["underwriterProcedure", "adminProcedure"],
          `${file} → ${mutation.name} is a mutation built from ${mutation.builder}`,
        ).toContain(mutation.builder);
      }
    });
  }
});
