/**
 * StructuralScanner (M12.1) — the first real engine behind the VirusScanner
 * port (ports.ts), closing the GAP-list item "AV verdict enforced BEFORE
 * extraction". Deterministic, zero-dependency, and runs entirely in the
 * worker: tax documents contain PII, so third-party AV APIs (VirusTotal
 * et al.) are OFF the table — anything that leaves our infrastructure
 * violates the ZDR posture.
 *
 * What it proves: the bytes ARE the format the uploader declared (magic
 * bytes), and PDFs carry none of the classic active-content attack vectors
 * (encryption that hides content from review, embedded JavaScript, launch
 * actions, embedded files). What it does NOT prove: absence of known
 * malware signatures — a ClamAV sidecar can replace this engine behind the
 * same port when pilots demand it (tracked in MASTER_TASK_LIST M12). The
 * engine name is recorded with every verdict so the audit trail shows
 * exactly what cleared each file.
 *
 * Verdict semantics: "infected" here means "not safe to process as
 * claimed" — the detail string always says precisely why.
 */

import { inflateSync } from "node:zlib";
import type { ScanResult, VirusScanner } from "../ports.js";

const ENGINE = "structural-v1";

/** Leading magic bytes per accepted mime (mirrors the upload allowlist). */
const MAGIC: Record<string, { name: string; prefixes: number[][] }> = {
  "application/pdf": { name: "PDF", prefixes: [[0x25, 0x50, 0x44, 0x46, 0x2d]] }, // %PDF-
  "image/png": { name: "PNG", prefixes: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  "image/jpeg": { name: "JPEG", prefixes: [[0xff, 0xd8, 0xff]] },
  "image/tiff": {
    name: "TIFF",
    prefixes: [
      [0x49, 0x49, 0x2a, 0x00], // little-endian
      [0x4d, 0x4d, 0x00, 0x2a], // big-endian
    ],
  },
  // XLSX is a ZIP container; XLS is an OLE compound file.
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    name: "XLSX (zip)",
    prefixes: [[0x50, 0x4b, 0x03, 0x04]],
  },
  "application/vnd.ms-excel": {
    name: "XLS (ole)",
    prefixes: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  },
};

/**
 * PDF tokens that mean active or hidden content. A legitimate tax form has
 * no business carrying any of them.
 *
 * Matching is evasion-aware (adversarial review, 2026-07-29 — both bypasses
 * below were reproduced against real PDFs before this hardening):
 * - PDF name objects may hex-escape any character (`/J#61vaScript` ≡
 *   `/JavaScript`, PDF 32000-1 §7.3.5), so bytes are normalized first.
 * - PDF 1.5 OBJECT STREAMS (`/Type /ObjStm`) hold ordinary dictionary
 *   objects — including `/OpenAction` and JS action dicts — Flate-
 *   compressed, and every reader decompresses and runs them. One
 *   `qpdf --object-streams=generate` hid a working `app.alert` from the
 *   first version of this scanner. Object streams are therefore inflated
 *   and scanned too. Page CONTENT streams stay unscanned on purpose:
 *   token text there is genuinely inert (it draws glyphs), and scanning
 *   it would reject documents that merely print the word.
 */
const PDF_FORBIDDEN: { token: string; why: string }[] = [
  { token: "/Encrypt", why: "encrypted PDF — content cannot be reviewed" },
  { token: "/JavaScript", why: "embedded JavaScript action" },
  { token: "/JS", why: "embedded JavaScript action" },
  { token: "/Launch", why: "launch action (executes external content)" },
  { token: "/EmbeddedFile", why: "embedded file attachment" },
];

/**
 * Decode `#XX` hex escapes so escaped name objects match their plain form.
 * Applied to a copy; never mutates the caller's bytes.
 */
function normalizeNameEscapes(bytes: Uint8Array): Uint8Array {
  const HASH = 0x23;
  if (!bytes.includes(HASH)) return bytes;
  const hex = (b: number | undefined): number =>
    b === undefined
      ? -1
      : b >= 0x30 && b <= 0x39
        ? b - 0x30
        : b >= 0x41 && b <= 0x46
          ? b - 0x37
          : b >= 0x61 && b <= 0x66
            ? b - 0x57
            : -1;
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === HASH) {
      const hi = hex(bytes[i + 1]);
      const lo = hex(bytes[i + 2]);
      if (hi >= 0 && lo >= 0) {
        out[n++] = (hi << 4) | lo;
        i += 2;
        continue;
      }
    }
    out[n++] = bytes[i]!;
  }
  return out.subarray(0, n);
}

/**
 * Inflate every object stream in the file and return the decompressed
 * payloads. Object streams are located by their `/ObjStm` dictionary and
 * inflated from the following `stream` keyword; a stream that fails to
 * inflate is skipped (a scanner must not crash on a malformed file — the
 * PDF parser downstream will reject it).
 */
function objectStreamPayloads(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  const marker = new TextEncoder().encode("/ObjStm");
  const streamKw = new TextEncoder().encode("stream");
  for (let i = 0; i + marker.length <= bytes.length; i++) {
    let hit = true;
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker[j]) {
        hit = false;
        break;
      }
    }
    if (!hit) continue;

    // Find the `stream` keyword that opens this object's data.
    let s = -1;
    const limit = Math.min(bytes.length, i + 4096);
    for (let k = i; k + streamKw.length <= limit; k++) {
      let m = true;
      for (let j = 0; j < streamKw.length; j++) {
        if (bytes[k + j] !== streamKw[j]) {
          m = false;
          break;
        }
      }
      if (m) {
        s = k + streamKw.length;
        break;
      }
    }
    if (s < 0) continue;
    if (bytes[s] === 0x0d) s++;
    if (bytes[s] === 0x0a) s++;

    try {
      out.push(new Uint8Array(inflateSync(Buffer.from(bytes.subarray(s)))));
    } catch {
      // Not Flate, truncated, or otherwise unreadable — skip.
    }
  }
  return out;
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function findToken(bytes: Uint8Array, token: string): boolean {
  // Tokens are ASCII; scan without decoding the whole file into a string.
  const t = new TextEncoder().encode(token);
  const boundary = (b: number | undefined) =>
    // A token match must end at a PDF delimiter/whitespace so "/JS" does
    // not fire on "/JSSomethingElse" (but "/JavaScript" would match its
    // own entry anyway).
    b === undefined || !((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a));
  outer: for (let i = 0; i + t.length <= bytes.length; i++) {
    for (let j = 0; j < t.length; j++) {
      if (bytes[i + j] !== t[j]) continue outer;
    }
    if (boundary(bytes[i + t.length])) return true;
  }
  return false;
}

export class StructuralScanner implements VirusScanner {
  scan(bytes: Uint8Array, mimeType: string): Promise<ScanResult> {
    try {
      if (bytes.length === 0) {
        return Promise.resolve({ status: "infected", engine: ENGINE, detail: "empty file" });
      }

      const magic = MAGIC[mimeType];
      if (!magic) {
        // Unknown mime should have been rejected at upload; refusing to
        // guess keeps the allowlists in one place.
        return Promise.resolve({
          status: "infected",
          engine: ENGINE,
          detail: `no structural profile for declared type ${mimeType}`,
        });
      }
      if (!magic.prefixes.some((p) => hasPrefix(bytes, p))) {
        return Promise.resolve({
          status: "infected",
          engine: ENGINE,
          detail: `magic bytes do not match declared ${magic.name}`,
        });
      }

      if (mimeType === "application/pdf") {
        // Scan the raw file AND every inflated object stream, each with
        // hex escapes decoded — the two evasions the review reproduced.
        const surfaces = [bytes, ...objectStreamPayloads(bytes)].map(normalizeNameEscapes);
        for (const { token, why } of PDF_FORBIDDEN) {
          for (const surface of surfaces) {
            if (findToken(surface, token)) {
              return Promise.resolve({
                status: "infected",
                engine: ENGINE,
                detail: `${why} (${token})`,
              });
            }
          }
        }
      }

      return Promise.resolve({ status: "clean", engine: ENGINE });
    } catch (e) {
      return Promise.resolve({
        status: "failed",
        engine: ENGINE,
        detail: (e as Error).message.slice(0, 200),
      });
    }
  }
}
