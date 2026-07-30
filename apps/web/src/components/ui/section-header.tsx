/**
 * SectionHeader (ui-25): the `text-heading` section title every dashboard
 * section uses (Deals, Usage, Recent activity). One place to change the
 * rhythm instead of a repeated literal.
 */

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function SectionHeader({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-heading mb-3", className)} {...props} />;
}
