import { describe, expect, it } from "vitest";
import { resolveProvider } from "./provider.js";
import { SandboxTranscriptProvider } from "./sandbox.js";

describe("SandboxTranscriptProvider (M19)", () => {
  it("registers under TRANSCRIPT_PROVIDER=sandbox and nowhere else", () => {
    expect(resolveProvider({ TRANSCRIPT_PROVIDER: "sandbox" })?.name).toBe("sandbox");
    expect(resolveProvider({ TRANSCRIPT_PROVIDER: "taxstatus" })).toBeNull();
    expect(resolveProvider({})).toBeNull();
  });

  it("consent lifecycle is instant-sign with a sandbox-prefixed ref", async () => {
    const p = new SandboxTranscriptProvider();
    const c = await p.requestConsent({ entityName: "Niyazi", entityExternalRef: "ent-1" });
    expect(c).toMatchObject({ externalRef: "sandbox:ent-1", status: "signed" });
  });

  it("transcripts are deterministic, whole-dollar, and registry-keyed", async () => {
    const p = new SandboxTranscriptProvider();
    const [a, b] = await Promise.all([
      p.fetchTranscripts("sandbox:ent-1", [2023]),
      p.fetchTranscripts("sandbox:ent-1", [2023]),
    ]);
    expect(a).toEqual(b); // same inputs, same "IRS"
    const s1120 = a!.find((x) => x.formFamily === "1120S")!;
    expect(s1120.lines.map((l) => l.registryFieldId)).toContain("f1120s.line21");
    for (const line of s1120.lines) {
      expect(BigInt(line.valueCents) % 100n).toBe(0n); // IRS reports whole dollars
    }
    // Different entity → different values (no cross-entity bleed).
    const other = await p.fetchTranscripts("sandbox:ent-2", [2023]);
    expect(other!.find((x) => x.formFamily === "1120S")!.lines[0]!.valueCents).not.toBe(
      s1120.lines[0]!.valueCents,
    );
  });
});
