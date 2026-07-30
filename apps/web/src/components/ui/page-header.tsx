import { cn } from "@/lib/utils";

/**
 * Page header (M11.1): one consistent title block for non-workspace
 * surfaces - h1 + optional description + right-aligned actions. Keeps
 * heading semantics stable for a11y and e2e.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string | undefined;
  actions?: React.ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
