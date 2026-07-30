"use client";

/**
 * Dark-mode toggle (M8.1, V1 visuals). Class strategy: `.dark` on <html>,
 * persisted in localStorage, defaulting to the OS preference. An inline
 * <script> in the layout applies the stored choice before first paint
 * (no flash). No next-themes - the boot script + this toggle are the
 * whole mechanism; `useIsDark` lets other components (sonner) follow it.
 */

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "credexis-theme";

/** Reactively tracks the `.dark` class on <html> (MutationObserver). */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    setDark(root.classList.contains("dark"));
    const observer = new MutationObserver(() => {
      setDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  if (dark === null) {
    // Avoid a mismatched flash on hydration - same footprint, no icon.
    return (
      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full">
        <span className="h-4 w-4" />
      </Button>
    );
  }

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    setDark(next);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 rounded-full hover:bg-accent transition-colors"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? (
        <Sun className="h-4 w-4 text-amber-400 transition-transform duration-300" />
      ) : (
        <Moon className="h-4 w-4 text-slate-600 transition-transform duration-300" />
      )}
    </Button>
  );
}

/** Runs before paint (inlined in layout) - never imported dynamically. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");var d=t? t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;
