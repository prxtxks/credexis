/**
 * Storage object keys (M2.4, moved here in M12.1 — design §4.5).
 *
 * The `deal-documents` bucket is private and every policy on it keys off path
 * segments, so keys are built HERE and nowhere else:
 *
 *   <tenant_id>/deals/<deal_id>/uploads/<sha256>.<ext>
 *   <tenant_id>/deals/<deal_id>/pages/<logical_document_id>/<page>.png
 *   <tenant_id>/deals/<deal_id>/borrower-uploads/<invite_id>/<sha256>.<ext>
 *
 * The borrower grammar has a second, independent enforcer: the RLS policy on
 * storage.objects calls `public.borrower_upload_key_ok()` (migration 0029 §c),
 * which re-derives the same six-element grammar in SQL. One grammar, two
 * languages: `keys.test.ts` reads 0029 and proves they still agree. Loosening
 * either side alone is a security bug, not a refactor.
 *
 * Objects are immutable (no UPDATE policy on the bucket): changed bytes → new
 * hash → new key. Contents are only ever served through short-TTL signed URLs
 * minted server-side.
 */

import { SHA256_HEX_RE } from "../hash.js";

/**
 * Mirrors the bucket's `allowed_mime_types` and maps each to the extension
 * the key carries. This set must stay a subset of the extension alternation
 * in 0029's segment-6 regex — a mime we accept but the policy's regex does
 * not would produce an upload that RLS rejects with no explanation. The test
 * asserts the containment against the SQL file itself.
 */
export const UPLOAD_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/tiff": "tif",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
};

/**
 * Lowercase canonical form ONLY. 0029 compares `invite.tenant_id::text =
 * segment` and Postgres renders `uuid::text` lowercase-canonical, so an
 * uppercase or brace-wrapped id builds a key the policy silently refuses —
 * an unexplainable 403 at upload time instead of a throw here. The same
 * assertion is what pins the element COUNT: an id containing `/` would split
 * into extra elements and fail 0029's `array_length(s,1) = 6` check.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) throw new Error(`${label} is not a lowercase uuid: "${value}"`);
}

function assertSha256(sha256: string): void {
  // Lowercase hex-64 — 0029's segment-6 regex is `[0-9a-f]{64}`, so an
  // uppercase digest is a policy denial, and `..` or `/` would be traversal.
  if (!SHA256_HEX_RE.test(sha256)) throw new Error(`sha256 is not lowercase hex-64: "${sha256}"`);
}

/**
 * `Object.hasOwn`, never a bare index or `in`: the allowlist is a plain
 * object literal, so a mimeType of `constructor`, `toString` or `__proto__`
 * resolves up the prototype chain to a truthy non-string that would be
 * stringified straight into the key.
 */
function uploadExtension(mimeType: string): string {
  const ext = Object.hasOwn(UPLOAD_EXTENSION_BY_MIME, mimeType)
    ? UPLOAD_EXTENSION_BY_MIME[mimeType]
    : undefined;
  if (typeof ext !== "string") throw new Error(`mime type not allowed for upload: "${mimeType}"`);
  return ext;
}

/** Key for an org-uploaded source document. Content-addressed → dedupe-friendly. */
export function uploadObjectKey(
  tenantId: string,
  dealId: string,
  sha256: string,
  mimeType: string,
): string {
  assertUuid(tenantId, "tenantId");
  assertUuid(dealId, "dealId");
  assertSha256(sha256);
  return `${tenantId}/deals/${dealId}/uploads/${sha256}.${uploadExtension(mimeType)}`;
}

/** Key for a rendered page image (written by the pipeline worker, M3.5). */
export function pageImageObjectKey(
  tenantId: string,
  dealId: string,
  logicalDocumentId: string,
  pageNumber: number,
): string {
  assertUuid(tenantId, "tenantId");
  assertUuid(dealId, "dealId");
  assertUuid(logicalDocumentId, "logicalDocumentId");
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error(`pageNumber must be a positive integer: ${pageNumber}`);
  }
  return `${tenantId}/deals/${dealId}/pages/${logicalDocumentId}/${pageNumber}.png`;
}

/**
 * Key for a borrower-portal upload (M12.1, design §5.1). Six `/`-separated
 * elements, every one of which 0029's `borrower_upload_key_ok()` re-checks
 * against the caller's own live invite:
 *
 *   <tenant_id>/deals/<deal_id>/borrower-uploads/<invite_id>/<sha256>.<ext>
 *        [1]     [2]     [3]           [4]           [5]         [6]
 *
 * Throwing beats emitting: a key this builder would not produce is a key the
 * policy denies, and a denial at the storage boundary is far harder to
 * diagnose than an exception at the call site. The invite id is part of the
 * PATH, not merely of the row, so per-invite listing, the object budget and
 * revocation are all prefix operations.
 */
export function borrowerUploadObjectKey(
  tenantId: string,
  dealId: string,
  inviteId: string,
  sha256: string,
  mimeType: string,
): string {
  assertUuid(tenantId, "tenantId");
  assertUuid(dealId, "dealId");
  assertUuid(inviteId, "inviteId");
  assertSha256(sha256);
  return `${tenantId}/deals/${dealId}/borrower-uploads/${inviteId}/${sha256}.${uploadExtension(mimeType)}`;
}
