/**
 * Audit log route (m12-3-audit-viewer, plan 01 §5 step 4). A SERVER
 * component whose only job is to opt this route out of static prerendering;
 * the screen itself is `audit-client.tsx`.
 *
 * Why the split: `export const dynamic` is route-segment config and is
 * IGNORED inside a "use client" module, so a fully-client page silently gets
 * prerendered at build time - which for a per-user, per-tenant authenticated
 * surface bakes an anonymous shell into the build output. That is the shape
 * of the 2026-07-29 production outage; the deals home carries the same
 * wrapper for the same reason (`app/page.tsx`).
 */
export const dynamic = "force-dynamic";

import AuditClient from "./audit-client";

export default function Page() {
  return <AuditClient />;
}
