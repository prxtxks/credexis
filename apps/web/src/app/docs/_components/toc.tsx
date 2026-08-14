"use client";

/**
 * "On this page" rail with scrollspy - the Vercel-docs affordance that
 * makes a long guide navigable. Pure client observer; no layout shift.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface TocEntry {
  id: string;
  title: string;
}

export function Toc({ entries }: { entries: TocEntry[] }) {
  const [active, setActive] = useState<string | null>(entries[0]?.id ?? null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (list) => {
        const hit = list.filter((e) => e.isIntersecting).sort((a, b) => a.time - b.time)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    for (const e of entries) {
      const el = document.getElementById(e.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [entries]);

  return (
    <nav aria-label="On this page" className="text-[12.5px]">
      <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
        On this page
      </p>
      <ul className="border-border space-y-0.5 border-l">
        {entries.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              className={cn(
                "-ml-px block border-l py-1 pl-3 transition-colors",
                active === e.id
                  ? "border-primary text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {e.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
