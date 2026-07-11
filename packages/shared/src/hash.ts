/**
 * Content hashing (M2.4). SHA-256 is the identity of uploaded bytes across
 * the whole system: `documents.sha256` (dedupe), storage object keys, and the
 * corpus manifest all bind to it. One implementation, hex-lowercase, no
 * variants.
 *
 * Uses Web Crypto (global in Node ≥ 18 and browsers) so this package stays
 * dependency-free and safe to import from client bundles.
 */

/** Minimal Web Crypto surface — tsconfig lib is ES-only (no DOM globals). */
declare const crypto: {
  subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> };
};

/** SHA-256 of raw bytes as lowercase hex (64 chars). */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Shape guard for hashes stored/received as text. */
export const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
