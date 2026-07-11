import { describe, expect, it } from "vitest";
import { SHA256_HEX_RE, sha256Hex } from "./hash.js";

describe("sha256Hex", () => {
  // Known vectors (FIPS 180-2 / openssl).
  it("hashes the empty input to the canonical empty-string digest", async () => {
    await expect(sha256Hex(new Uint8Array(0))).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it('hashes "abc" to the canonical test vector', async () => {
    await expect(sha256Hex(new TextEncoder().encode("abc"))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("produces output matching SHA256_HEX_RE", async () => {
    await expect(sha256Hex(new TextEncoder().encode("credexis"))).resolves.toMatch(SHA256_HEX_RE);
  });

  it("differs on a single flipped bit", async () => {
    const a = await sha256Hex(new Uint8Array([0]));
    const b = await sha256Hex(new Uint8Array([1]));
    expect(a).not.toBe(b);
  });
});
