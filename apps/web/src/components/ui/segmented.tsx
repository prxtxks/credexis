"use client";

/**
 * Segmented control (ui-25, 02-VERCEL-DERIVATION §3.12): the ONE bordered
 * pill-group toggle - grid/list view, feed/table, phone status filter.
 * Anatomy is fixed (hairline container p-0.5, active option = accent fill,
 * rounded-[6px]); size and per-site placement come in via props so every
 * call site renders byte-identical to the hand-rolled originals it replaced.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  /** Text or an icon element. Icon-only options MUST set ariaLabel. */
  label: ReactNode;
  ariaLabel?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "sm",
  className,
  itemClassName,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** sm = h-8 (toolbar rows), md = h-9 (page toolbar), auto = options pad themselves. */
  size?: "sm" | "md" | "auto";
  className?: string;
  itemClassName?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "border-border flex items-center rounded-lg border p-0.5",
        size === "sm" && "h-8",
        size === "md" && "h-9",
        className,
      )}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-label={o.ariaLabel}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center rounded-[6px] text-[13px] font-medium transition-colors duration-150",
              size === "auto" ? "px-3 py-1.5" : "h-full px-2.5",
              active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              itemClassName,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
