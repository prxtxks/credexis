"use client";

/**
 * FieldSelect (ui-8, design language §3): the ONE way to render a dropdown
 * field. Wraps the shadcn/Radix Select so call sites stay as small as the
 * native <select> they replace: options in, value out. The menu is a
 * surface-2 overlay (opaque bg-popover, hairline, shadow) — the "zero
 * styling" native dropdowns are retired everywhere.
 *
 * Radix forbids empty-string item values, so `value=""` (common for
 * "unassigned") is mapped to an internal sentinel and back.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const EMPTY = "__empty__";

export interface FieldSelectOption {
  value: string;
  label: string;
}

export function FieldSelect({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  disabled,
  className,
  size = "sm",
}: {
  value: string;
  onChange: (value: string) => void;
  options: FieldSelectOption[];
  /** Label for the empty/none choice; when set, an empty-value option is offered. */
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
}) {
  return (
    <Select
      value={value === "" ? EMPTY : value}
      onValueChange={(v) => onChange(v === EMPTY ? "" : v)}
      disabled={disabled ?? false}
    >
      <SelectTrigger aria-label={ariaLabel} size={size} className={cn("min-w-28", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {placeholder !== undefined ? <SelectItem value={EMPTY}>{placeholder}</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
