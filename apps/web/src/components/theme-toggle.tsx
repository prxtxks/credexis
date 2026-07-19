"use client";

/**
 * Dark-mode toggle (M8.1). Class strategy: `.dark` on <html>, persisted in
 * localStorage, defaulting to the OS preference. An inline <script> in the
 * layout applies the stored choice before first paint (no flash).
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "credexis-theme";

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  if (dark === null) return null; // avoid a mismatched flash on hydration

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    setDark(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-md border border-line dark:border-line-dark px-2 py-1 text-sm"
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}

/** Runs before paint (inlined in layout) — never imported dynamically. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");var d=t? t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;
