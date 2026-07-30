/**
 * Deals home. A SERVER component whose only job is to opt this route out of
 * static prerendering; the dashboard itself is `dashboard-client.tsx`.
 *
 * Why the split: `export const dynamic` is route-segment config and is
 * IGNORED inside a "use client" module, so a fully-client page silently gets
 * prerendered at build time. For a per-user authenticated dashboard that is
 * wrong twice over - it bakes an anonymous shell into the build output, and
 * in production that shell stuck permanently on the route-level loading
 * fallback ("Loading your deals…") while /costs rendered fine.
 */
export const dynamic = "force-dynamic";

import DashboardClient from "./dashboard-client";

export default function Page() {
  return <DashboardClient />;
}
