import type { ReactNode } from "react";

import {
  IconBook,
  IconChart,
  IconPlus,
  IconTeam,
} from "@/components/icons";
import { navIcons } from "@/components/app-shell";
import { isStaff } from "@/lib/auth/session";
import type { UserRole } from "@/lib/types/database";

export type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  exact?: boolean;
};

/**
 * Badge counts the shell shows next to nav items. Computed once by the app
 * layout so the sidebar does not have to be re-sent per page.
 */
export type NavCounts = {
  /** Customer: tickets that are Open or In Progress. */
  customerActive: number;
  /** Staff: tickets still in the Open column. */
  staffOpen: number;
};

export const EMPTY_COUNTS: NavCounts = { customerActive: 0, staffOpen: 0 };

/**
 * The single source of truth for the sidebar. Previously every page built its
 * own copy inline; moving the shell into the layout means the nav has to be
 * derivable from the role alone.
 */
export function buildNav(role: UserRole, counts: NavCounts): NavItem[] {
  if (isStaff(role)) {
    return [
      { href: "/agent", label: "Ringkasan", icon: navIcons.dashboard, exact: true },
      {
        href: "/agent/board",
        label: "Board Tiket",
        icon: navIcons.tasks,
        badge: counts.staffOpen || undefined,
      },
      { href: "/knowledge", label: "Knowledge Base", icon: <IconBook /> },
      { href: "/agent/analytics", label: "Analitik", icon: <IconChart /> },
      // Only admins reach this area at all (requireStaff), so it is always shown.
      { href: "/admin/users", label: "Kelola Pengguna", icon: <IconTeam /> },
      { href: "/settings", label: "Pengaturan", icon: navIcons.gear },
    ];
  }

  return [
    { href: "/dashboard", label: "Dashboard", icon: navIcons.dashboard, exact: true },
    {
      href: "/dashboard/tickets",
      label: "Tiket Saya",
      icon: navIcons.ticket,
      badge: counts.customerActive || undefined,
    },
    { href: "/dashboard/new", label: "Ajukan Keluhan", icon: <IconPlus /> },
    { href: "/knowledge", label: "Knowledge Base", icon: <IconBook /> },
    { href: "/settings", label: "Pengaturan", icon: navIcons.gear },
  ];
}
