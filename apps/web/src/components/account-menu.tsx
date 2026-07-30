"use client";

/**
 * Account menu (ui-14-2, design 01 §1.4 + §5 step 2). Before this, the
 * signed-in user existed nowhere in the product except the text input on
 * /settings that sets their name — which is why the shell read as
 * scaffolding rather than software. Top-right identity is the anchor every
 * portal Pratik named (Vercel, Linear, Claude) puts there.
 *
 * Identity is READ, never derived: every field comes from profile.get, and
 * the initials are a substring of a string the server sent (Iron Law #1/#3
 * — the client renders, it never computes).
 *
 * Avatars are INITIALS ONLY — Pratik decision D2 (design 01 §8): no upload,
 * no storage bucket, no image moderation, no extra PII, and indistinguishable
 * from a photo at 36px.
 *
 * First consumer of components/ui/dropdown-menu.tsx, which survived the
 * dead-UI sweep (step 1) only on the condition that this step consume it.
 */

import Link from "next/link";
import { LogOut, Moon, Settings, Sun, UserRound } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { useIsDark } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Mirrors the members page: the DB enum is not a display string.
 *  Exported — /settings prints the same identity line (ui-17). */
export const ROLE_LABEL: Record<string, string> = {
  org_owner: "Owner",
  admin: "Admin",
  underwriter: "Underwriter",
  viewer: "Viewer",
};

/**
 * Must stay byte-identical with theme-toggle.tsx's STORAGE_KEY. The flip is
 * re-implemented here instead of reusing <ThemeToggle/> because that
 * component is a <Button>, and a plain button nested in a Radix menu sits
 * outside the menu's roving focus — unreachable by keyboard. Reading the
 * current theme still goes through the shared useIsDark().
 */
const THEME_STORAGE_KEY = "credexis-theme";

/** First + last initial; a single name gives two letters; else the email. */
function initialsOf(fullName: string | null | undefined, email: string | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  if (first && last) return (first.charAt(0) + last.charAt(0)).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  return (email ?? "").slice(0, 1).toUpperCase();
}

export function AccountMenu({ variant = "avatar" }: { variant?: "avatar" | "row" } = {}) {
  const dark = useIsDark();
  // Identity changes about once a year and the shell mounts this on every
  // route — a fresh fetch per navigation would be pure noise.
  const profile = trpc.profile.get.useQuery(undefined, { staleTime: 5 * 60_000 });

  const me = profile.data;
  const name = me?.fullName?.trim();
  const initials = me ? initialsOf(me.fullName, me.email) : "";
  // Email is the identity when no name is set — never printed twice.
  const primary = name || me?.email;
  const secondary = name ? me?.email : undefined;
  // Before the query lands (and if it fails) an empty circle reads as broken;
  // the glyph says "we don't know who you are yet" without inventing a name.
  const mark = initials || <UserRound className="size-4 text-muted-foreground" />;

  return (
    <>
      {/* Outside the menu on purpose: DropdownMenuContent is portalled to
          <body>, so the Sign out item reaches this form by `form=` id
          association. POST-only, exactly as the top-bar form it replaces. */}
      <form id="account-sign-out" action="/auth/signout" method="post" className="hidden" />

      <DropdownMenu>
        <DropdownMenuTrigger
          // The accessible name must not flip once the query lands, so the
          // loading state carries the generic label rather than a stand-in.
          aria-label={primary ? `Account — ${primary}` : "Account"}
          className={
            variant === "row"
              ? // Sidebar identity footer (ui-17): the reference anchors the
                // person bottom-left as a full row, not a corner avatar.
                "flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 text-left transition-colors duration-150 hover:bg-sidebar-accent/60 data-[state=open]:bg-sidebar-accent"
              : "flex size-9 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold tracking-wide text-foreground transition-colors duration-150 hover:bg-accent data-[state=open]:bg-accent"
          }
        >
          {variant === "row" ? (
            <>
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold tracking-wide"
              >
                {mark}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                {primary ?? "…"}
              </span>
            </>
          ) : (
            mark
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align={variant === "row" ? "start" : "end"}
          side={variant === "row" ? "top" : "bottom"}
          sideOffset={8}
          className="w-64 rounded-xl border-border p-1.5 shadow-lg"
        >
          <div className="flex items-center gap-2.5 px-2 py-2">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold tracking-wide"
            >
              {mark}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-foreground">{primary ?? "…"}</p>
              {secondary ? (
                <p className="truncate text-[11px] text-muted-foreground">{secondary}</p>
              ) : null}
            </div>
          </div>

          {me ? (
            <div className="flex items-center gap-2 px-2 pb-2">
              <Badge variant="secondary" className="px-1.5 text-[11px] font-medium">
                {ROLE_LABEL[me.role] ?? me.role}
              </Badge>
              {me.orgName ? (
                <span className="truncate text-[11px] text-muted-foreground">{me.orgName}</span>
              ) : null}
            </div>
          ) : null}

          <DropdownMenuSeparator />

          {/* Plan 01 step 2 specified a Settings item; it was dropped in the
              first build — the menu promised navigation it did not offer. */}
          <DropdownMenuItem asChild className="rounded-lg text-[13px]">
            <Link href="/settings">
              <Settings />
              <span>Settings</span>
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem
            className="rounded-lg text-[13px]"
            // Closing on select would hide the one surface whose repaint is
            // the feedback; the menu stays open through the flip.
            onSelect={(event) => {
              event.preventDefault();
              const next = !dark;
              document.documentElement.classList.toggle("dark", next);
              localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
            }}
          >
            {dark ? <Sun /> : <Moon />}
            <span>{dark ? "Switch to light mode" : "Switch to dark mode"}</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild variant="destructive" className="rounded-lg text-[13px]">
            <button type="submit" form="account-sign-out" className="w-full">
              <LogOut />
              <span>Sign out</span>
            </button>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
