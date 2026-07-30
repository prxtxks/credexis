/**
 * List / ListRow (ui-25, 02-VERCEL-DERIVATION §3.6): the hairline-divided
 * rows-in-a-surface pattern - deals list view, notifications, activity.
 * `List` is the surface + dividers; `ListRow` is the standard row shell.
 * Row INTERIORS stay at the call site (leading dot, pills, menus) - the
 * primitive owns rhythm, not content.
 */

import type { HTMLAttributes, LiHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function List({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={cn("glass-card divide-border/70 divide-y rounded-lg", className)} {...props} />
  );
}

export function ListRow({ className, ...props }: LiHTMLAttributes<HTMLLIElement>) {
  return <li className={cn("flex items-start gap-3 px-4 py-3.5", className)} {...props} />;
}
