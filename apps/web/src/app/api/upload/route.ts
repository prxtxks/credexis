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
import { resolveDealLimits, sha256Hex } from "@credexis/shared";
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

  // M12.1 per-deal quota (borrower-portal prerequisite): count + total
  // bytes against tenants.settings.limits (defaults in @credexis/shared).
  // This is the friendly wall; migration 0021's BEFORE INSERT trigger on
  // documents is the backstop no caller — including the worker — can skip.
  const [{ data: tenantRow }, { data: existing }] = await Promise.all([
    supabase.from("tenants").select("settings").eq("id", tenantId).single(),
    supabase.from("documents").select("bytes").eq("deal_id", dealId),
  ]);
  const limits = resolveDealLimits(tenantRow?.settings);
  const docCount = (existing ?? []).length;
  const totalBytes = (existing ?? []).reduce((acc, d) => acc + ((d.bytes as number) ?? 0), 0);
  if (docCount >= limits.maxDocsPerDeal) {
    return NextResponse.json(
      { error: `deal document limit reached (${limits.maxDocsPerDeal} files)` },
      { status: 429 },
    );
  }
  if (totalBytes + file.size > limits.maxBytesPerDeal) {
    return NextResponse.json(
      {
        error: `deal storage limit reached (${Math.floor(limits.maxBytesPerDeal / 1_048_576)} MiB total)`,
      },
      { status: 429 },
    );
  }

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
  // True only when THIS request created the object — the "already exists"
  // branch above means the bytes belong to an earlier (possibly another
  // deal's) row, so cleanup below must not touch them.
  const objectCreatedHere = !storageErr;

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
    // No documents row ⇒ nothing references these bytes: an orphan that no
    // quota counts and no UI shows. Delete what this request wrote (a bad
    // dealId, or the 0021 quota trigger firing, used to leave 50 MiB
    // stranded in the bucket per attempt).
    if (objectCreatedHere) {
      await supabase.storage.from(DEAL_DOCUMENTS_BUCKET).remove([objectKey]);
    }
    // The quota backstop raises a plain exception — surface it as the same
    // 429 the pre-check returns, not a confusing 502.
    const quotaHit = /deal (document|storage) limit reached/i.test(insertErr.message);
    return NextResponse.json({ error: insertErr.message }, { status: quotaHit ? 429 : 502 });
  }

  // Kick the pipeline (no-op with a logged reason until Trigger is deployed).
  // Intake → Parsing on the deal's FIRST document. Done here, in the request
  // path, rather than only in the worker: triggerIngest is best-effort and
  // returns {triggered:false} whenever the queue is unconfigured or answers
  // non-2xx, so a worker-only transition would leave the board frozen in
  // exactly the environments where nothing else reveals it.
  //
  // Monotonic by construction — the WHERE clause only matches 'intake', so a
  // concurrent upload cannot drag a deal already in review backwards, and a
  // re-upload is a no-op. Best-effort: a deal whose status did not move is a
  // cosmetic problem, never a reason to fail an accepted document.
  const { error: statusErr } = await supabase
    .from("deals")
    .update({ status: "parsing" })
    .eq("id", dealId)
    .eq("status", "intake");
  if (statusErr) {
    console.warn(`deal status intake→parsing failed for ${dealId}: ${statusErr.message}`);
  }

  const triggered = await triggerIngest({ documentId: doc.id as string, tenantId, dealId });

  return NextResponse.json(
    { document: { id: doc.id, status: doc.status }, pipeline: triggered },
    { status: 201 },
  );
}
