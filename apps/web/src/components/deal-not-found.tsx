/**
 * Terminal state for deals.get NOT_FOUND (M18 honesty rule: an explicit
 * "not there" beats a quiet wrong answer). RLS makes a nonexistent deal
 * and another tenant's deal deliberately indistinguishable, so the copy
 * covers both. Deal pages must render this INSTEAD of their empty-deal
 * affordances - "ENTITIES 0" on a deal the tenant cannot see reads as a
 * real empty deal.
 */

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** True when a deals.get query error is the terminal NOT_FOUND state. */
export function isDealNotFound(
  error: { data?: { code?: string } | null | undefined } | null | undefined,
): boolean {
  return error?.data?.code === "NOT_FOUND";
}

export function DealNotFoundPanel({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn("glass-card mx-auto w-full max-w-md rounded-xl p-6", className)}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          aria-hidden="true"
          className="text-severity-critical mt-0.5 size-5 shrink-0"
        />
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold">Deal not found</h1>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            This deal doesn't exist, or your organization doesn't have access to it. If a teammate
            shared this link, check that you're signed in with the right organization.
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link href="/">Back to deals</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
