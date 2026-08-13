import { describe, expect, it } from "vitest";
import { LEARNED_MAPPINGS_SEED } from "./learned-mappings.js";
import { TAXONOMY_V1 } from "./taxonomy.js";

describe("learned-mappings seed integrity", () => {
  const keys = new Set(TAXONOMY_V1.map((n) => n.key));

  it("every seeded node exists in the taxonomy", () => {
    const bad = LEARNED_MAPPINGS_SEED.filter((m) => !keys.has(m.node));
    expect(bad.map((b) => `${b.label} -> ${b.node}`)).toEqual([]);
  });

  it("labels are unique after mapper normalization", () => {
    // Full mapper normalization, including the QuickBooks account-code
    // strip. ANY label_norm duplicate is a bug - even same-node ones:
    // the seed's single INSERT ... ON CONFLICT DO UPDATE cannot touch
    // the same row twice (Postgres 21000).
    const norm = (l: string) =>
      l
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(total (?:for )?)?\d{3,5}(?: \d{1,4})* /, "$1")
        .trim();
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const m of LEARNED_MAPPINGS_SEED) {
      const n = norm(m.label);
      const prior = seen.get(n);
      if (prior !== undefined)
        clashes.push(`"${m.label}" collides on "${n}" (${prior} vs ${m.node})`);
      seen.set(n, m.node);
    }
    expect(clashes).toEqual([]);
  });
});
