/**
 * Storage layout (M2.4) - the single place object keys are built.
 *
 * Bucket `deal-documents` is private; RLS on storage.objects keys on the
 * FIRST path segment being the caller's tenant id, so every key built here
 * starts with it:
 *
 *   <tenant_id>/deals/<deal_id>/uploads/<sha256>.<ext>
 *   <tenant_id>/deals/<deal_id>/pages/<logical_document_id>/<page>.png
 *
 * Objects are immutable (no UPDATE policy): a changed file is new bytes →
 * new hash → new key. Access to file contents is only ever granted through
 * short-TTL signed URLs created server-side.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const DEAL_DOCUMENTS_BUCKET = "deal-documents";

/** Signed URLs die fast (Blueprint §11): long enough to render, no more. */
export const SIGNED_URL_TTL_SECONDS = 120;

/** Mirrors the bucket's `file_size_limit` (50 MiB). */
export const MAX_UPLOAD_BYTES = 52_428_800;

/** Mirrors the bucket's `allowed_mime_types`; maps to the key extension. */
export const UPLOAD_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/tiff": "tif",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) throw new Error(`${label} is not a lowercase uuid: "${value}"`);
}

/** Key for an uploaded source document. Content-addressed → dedupe-friendly. */
export function uploadObjectKey(
  tenantId: string,
  dealId: string,
  sha256: string,
  mimeType: string,
): string {
  assertUuid(tenantId, "tenantId");
  assertUuid(dealId, "dealId");
  if (!SHA256_RE.test(sha256)) throw new Error(`sha256 is not lowercase hex-64: "${sha256}"`);
  const ext = UPLOAD_EXTENSION_BY_MIME[mimeType];
  if (!ext) throw new Error(`mime type not allowed for upload: "${mimeType}"`);
  return `${tenantId}/deals/${dealId}/uploads/${sha256}.${ext}`;
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
 * Server-side only. The caller's RLS-scoped client means a user can only
 * sign URLs for objects their tenant policies let them SELECT.
 */
export async function createSignedDocumentUrl(
  supabase: SupabaseClient,
  objectKey: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DEAL_DOCUMENTS_BUCKET)
    .createSignedUrl(objectKey, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(`could not sign storage url for "${objectKey}": ${error?.message}`);
  }
  return data.signedUrl;
}
