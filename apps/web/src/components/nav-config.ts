import { Briefcase, Coins, Settings, Users, type LucideIcon } from "lucide-react";

/**
 * One nav vocabulary for the sidebar and the mobile sheet (ui-17). Grouped
 * the way the reference groups them: the work first, the organization
 * second. Members moves under Settings when plan 01 step 11 lands.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact: boolean;
}

export const NAV_MAIN: NavItem[] = [
  { href: "/", label: "Deals", icon: Briefcase, exact: true },
  { href: "/costs", label: "Costs", icon: Coins, exact: false },
];

export const NAV_ORG: NavItem[] = [
  { href: "/settings/members", label: "Members", icon: Users, exact: false },
  { href: "/settings", label: "Settings", icon: Settings, exact: true },
];

/**
 * Settings sub-nav (ui-17-settings, plan 01 step 11 in the reference's
 * sidebar-takeover idiom). Members lives here now; /org/members redirects.
 */
export const NAV_SETTINGS: { href: string; label: string }[] = [
  { href: "/settings", label: "General" },
  { href: "/settings/members", label: "Members" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/audit", label: "Audit log" },
  { href: "/settings/plan", label: "Plan & Usage" },
];

/**
 * Deal sub-nav (ui-17-deal-scope): inside /deals/[id] the rail scopes to
 * the deal, as the reference scopes to a project. Workspace keeps its own
 * cockpit chrome; these are the page-style deal surfaces.
 */
export const NAV_DEAL: { segment: string; label: string }[] = [
  { segment: "overview", label: "Overview" },
  { segment: "workspace", label: "Workspace" },
  { segment: "documents", label: "Documents" },
  { segment: "review", label: "Review queue" },
  { segment: "assignment", label: "Assignment" },
  { segment: "borrower", label: "Borrower portal" },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
