import { cn } from "@/lib/utils";

/** Loading placeholder (M11.1): shimmer over muted surface. Prefer
 *  skeletons that mirror the loaded layout over bare spinners. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="skeleton" className={cn("shimmer rounded-md bg-muted", className)} {...props} />
  );
}

export { Skeleton };
