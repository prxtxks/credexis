/**
 * Borrower upload (M12.1, design §10.4). The only route in this app that
 * accepts bytes.
 *
 * Runs AS THE BORROWER: the RLS-scoped anon-key client performs the storage
 * write, so `deal_documents_borrower_insert` — which validates every path
 * segment against the caller's own live invite — is the real boundary, not
 * this file. The browser could call the Storage API directly and hit the same
 * wall (Iron Law #7: no service-role key in a request path).
 *
 * The `documents` row is NOT written here. `borrower_attach_upload` is the
 * only writer: it re-derives the key from the invite, reads the authoritative
 * byte size off the stored object so a caller cannot understate it to evade a
 * quota, and fails closed if the upload never finalized.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Local sha256 rather than @credexis/shared. The portal deliberately depends
 * on no workspace package — that is what keeps underwriting code out of the
 * borrower deployment — and this is four lines of WebCrypto. The digest must
 * agree with the staff app's, so both are plain lowercase hex of the raw
 * bytes; the SQL side only ever regex-checks that shape.
 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const BUCKET = "deal-documents";
const MAX_UPLOAD_BYTES = 52_428_800; // 50 MiB — mirrors the bucket's own limit.

/** Mirrors the SQL validator's extension alternation (migration 0029). */
const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/tiff": "tif",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();

  // Fail closed: an unreachable auth server is an unauthenticated caller.
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // The caller does NOT get to name their invite. It is re-derived from the
  // session every time, so a borrower holding two invites cannot aim an
  // upload at the wrong one, and a stale id in a replayed request is inert.
  const { data: inviteIds, error: inviteErr } = await supabase.rpc("current_invite_ids");
  if (inviteErr) {
    return NextResponse.json({ error: "could not resolve your invitation" }, { status: 502 });
  }
  const inviteId = ((inviteIds as string[] | null) ?? [])[0];
  if (!inviteId) {
    return NextResponse.json({ error: "no active invitation" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  const ext = Object.hasOwn(EXTENSION_BY_MIME, file.type)
    ? EXTENSION_BY_MIME[file.type]
    : undefined;
  if (!ext) {
    // Borrower-facing copy: name what IS accepted rather than echoing a mime
    // type they cannot act on.
    return NextResponse.json(
      { error: "That file type isn't supported. Please send a PDF, image or spreadsheet." },
      { status: 415 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That file is larger than 50 MB." }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(bytes);

  // The KEY is derived in SQL (borrower_upload_key, migration 0033), not here.
  // A borrower has no SELECT policy on borrower_invites, so this app cannot
  // read its own tenant/deal ids to build a path — and giving it those ids
  // just to rebuild a string the database already knows how to build would
  // put two producers of a security-relevant path in the system. One producer
  // cannot drift from itself.
  const { data: keyData, error: keyErr } = await supabase.rpc("borrower_upload_key", {
    p_sha256: sha256,
    p_ext: ext,
  });
  const key = typeof keyData === "string" ? keyData : null;
  if (keyErr || !key) {
    return NextResponse.json({ error: "your invitation is no longer active" }, { status: 403 });
  }

  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .upload(key, bytes, { contentType: file.type, upsert: false });
  // Identical bytes land on the same key, so a re-send is a no-op rather than
  // an error the borrower has to understand.
  const alreadyThere = storageErr !== null && /already exists|duplicate/i.test(storageErr.message);
  if (storageErr && !alreadyThere) {
    // The storage policy is what rejects a path that is not this borrower's.
    return NextResponse.json({ error: "we couldn't store that file" }, { status: 403 });
  }

  const { data: attached, error: attachErr } = await supabase.rpc("borrower_attach_upload", {
    p_invite: inviteId,
    p_sha256: sha256,
    p_ext: ext,
    p_file_name: file.name,
  });
  if (attachErr) {
    return NextResponse.json({ error: "we couldn't record that file" }, { status: 502 });
  }

  // Always 201, whether the file was new or a duplicate: "received" is the
  // only thing a borrower is told, so re-sending reveals nothing about what
  // the lender already holds.
  return NextResponse.json({ received: true, document: attached }, { status: 201 });
}
