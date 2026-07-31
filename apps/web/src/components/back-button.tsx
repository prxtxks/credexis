"use client";

/**
 * History-aware back (ui-26, Pratik: "if I went to the workspace from the
 * overview, back should land on the overview; from the homepage, the
 * homepage"). router.back() replays the real journey; the deals home is
 * only the fallback for deep links opened in a fresh tab, where there is
 * no in-app history to return to.
 */

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BackButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 shrink-0 rounded-full"
      aria-label="Back"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/");
      }}
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );
}
