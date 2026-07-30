import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * SettingsCard (ui-17, 02-VERCEL-DERIVATION §3.5) — the reference's
 * settings workhorse: title, prose description, arbitrary content, and a
 * hairline-separated footer strip (hint left, action right). The danger
 * variant carries the red hairline + tinted footer.
 *
 * Replaces the Card + glass-card stack (card.tsx dies in this PR —
 * plan 01 §4.1).
 */
export function SettingsCard({
  title,
  description,
  children,
  footer,
  footerAction,
  variant = "default",
  className,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Left side of the footer strip — 13px muted, may contain links. */
  footer?: ReactNode;
  /** Right side of the footer strip — usually one small button. */
  footerAction?: ReactNode;
  variant?: "default" | "danger";
  className?: string;
}) {
  const danger = variant === "danger";
  return (
    <section
      className={cn(
        "rounded-xl border bg-card shadow-sm",
        danger ? "border-severity-critical/40" : "border-border",
        className,
      )}
    >
      <div className="p-5 sm:p-6">
        <h2 className="text-title">{title}</h2>
        {description ? (
          <div className="text-muted-foreground mt-1.5 max-w-2xl text-sm">{description}</div>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
      {footer !== undefined || footerAction !== undefined ? (
        <div
          className={cn(
            "flex min-h-12 items-center justify-between gap-3 rounded-b-xl border-t px-5 py-2.5 sm:px-6",
            danger
              ? "border-severity-critical/40 bg-severity-critical/10"
              : "border-border bg-accent/20",
          )}
        >
          <div className="text-muted-foreground text-[13px]">{footer}</div>
          {footerAction ? <div className="shrink-0">{footerAction}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
