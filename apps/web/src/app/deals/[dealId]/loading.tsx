import { PageLoading } from "@/components/ui/page-loading";

/** One skeleton, one label — the doubled "Loading…/Loading workspace…"
 *  stack was Pratik-reported (2026-07-30). */
export default function DealLoading() {
  return <PageLoading label="Loading workspace" />;
}
