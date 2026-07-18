/**
 * Upload endpoint (M3.1): multipart file + dealId → storage (content-
 * addressed, tenant-prefixed) → documents row → pipeline trigger.
 *
 * Runs AS THE CALLER: the RLS-scoped client enforces tenant prefix and
 * role on the storage write and the row insert (Iron Law #7 — no service
 * key anywhere near this path). Dedupe is the DB's unique(deal_id, sha256)
 * — re-uploading identical bytes returns 409 with the existing document.
 */

import { NextResponse, type NextRequest } from "next/server";
import { sha256Hex } from "@credexis/shared";
import { createClient } from "@/lib/supabase/server";
import {
  DEAL_DOCUMENTS_BUCKET,
  MAX_UPLOAD_BYTES,
  UPLOAD_EXTENSION_BY_MIME,
  uploadObjectKey,
} from "@/lib/storage";
import { triggerIngest } from "@/server/pipeline/trigger-client";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  // Fail closed: an unreachable auth server is an unauthenticated caller,
  // never a 500 (same posture as the middleware).
  let user;
  try {
    const res = await supabase.auth.getUser();
    user = res.data.user;
  } catch {
    user = null;
  }
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "no tenant" }, { status: 403 });
  if (profile.role === "viewer") {
    return NextResponse.json({ error: "viewers cannot upload" }, { status: 403 });
  }

  const form = await request.formData();
  const dealId = form.get("dealId");
  const file = form.get("file");
  if (typeof dealId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "dealId and file are required" }, { status: 400 });
  }
  if (!(file.type in UPLOAD_EXTENSION_BY_MIME)) {
    return NextResponse.json({ error: `unsupported type: ${file.type}` }, { status: 415 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file exceeds 50 MiB" }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const tenantId = profile.tenant_id as string;

  let objectKey: string;
  try {
    objectKey = uploadObjectKey(tenantId, dealId, sha256, file.type);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // Content-addressed upload: identical bytes land on the same key, so a
  // second upload of the same file is a no-op at the storage layer.
  const { error: storageErr } = await supabase.storage
    .from(DEAL_DOCUMENTS_BUCKET)
    .upload(objectKey, bytes, { contentType: file.type, upsert: false });
  if (storageErr && !/already exists|duplicate/i.test(storageErr.message)) {
    return NextResponse.json({ error: `storage: ${storageErr.message}` }, { status: 502 });
  }

  const { data: doc, error: insertErr } = await supabase
    .from("documents")
    .insert({
      tenant_id: tenantId,
      deal_id: dealId,
      file_name: file.name,
      storage_path: objectKey,
      sha256,
      bytes: file.size,
      mime_type: file.type,
      uploaded_by: user.id,
    })
    .select("id, status")
    .single();

  if (insertErr) {
    // unique(deal_id, sha256) → this exact file is already on the deal.
    if (insertErr.code === "23505") {
      const { data: existing } = await supabase
        .from("documents")
        .select("id, status")
        .eq("deal_id", dealId)
        .eq("sha256", sha256)
        .maybeSingle();
      return NextResponse.json(
        { error: "duplicate: this file is already uploaded to this deal", document: existing },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: insertErr.message }, { status: 502 });
  }

  // Kick the pipeline (no-op with a logged reason until Trigger is deployed).
  const triggered = await triggerIngest({ documentId: doc.id as string, tenantId, dealId });

  return NextResponse.json(
    { document: { id: doc.id, status: doc.status }, pipeline: triggered },
    { status: 201 },
  );
}
