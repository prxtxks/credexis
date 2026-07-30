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
  { href: "/org/members", label: "Members", icon: Users, exact: false },
  { href: "/settings", label: "Settings", icon: Settings, exact: false },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
