import type { ReactNode } from "react";

import {
  IconChart,
  IconDashboard,
  IconGear,
  IconPlus,
  IconTasks,
  IconTeam,
  IconTicket,
} from "@/components/icons";
import { isStaff } from "@/lib/auth/session";
import type { UserRole } from "@/lib/types/database";

export type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  exact?: boolean;
  /**
   * Extra path prefixes that belong to this item even though they live on a
   * different route — reading a ticket is part of "Board Tiket", so the sidebar
   * keeps that entry highlighted instead of going blank.
   */
  match?: string[];
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
 *
 * The icons are created here, in a server module, on purpose. This function
 * runs in the server layout while `AppShell` is a client component, so a
 * shared element constant imported from the client module would arrive as a
 * module-reference stub — every icon silently rendered as an empty box.
 * Building each element inline (like `<IconPlus />` below) is what actually
 * crosses the boundary.
 */
export function buildNav(role: UserRole, counts: NavCounts): NavItem[] {
  if (isStaff(role)) {
    return [
      { href: "/agent", label: "Ringkasan", icon: <IconDashboard />, exact: true },
      {
        href: "/agent/board",
        label: "Board Tiket",
        icon: <IconTasks />,
        badge: counts.staffOpen || undefined,
        match: ["/agent/tickets"],
      },
      { href: "/agent/analytics", label: "Analitik", icon: <IconChart /> },
      // Only admins reach this area at all (requireStaff), so it is always shown.
      { href: "/admin/users", label: "Kelola Pengguna", icon: <IconTeam /> },
      { href: "/settings", label: "Pengaturan", icon: <IconGear /> },
    ];
  }

  return [
    { href: "/dashboard", label: "Dashboard", icon: <IconDashboard />, exact: true },
    {
      href: "/dashboard/tickets",
      label: "Tiket Saya",
      icon: <IconTicket />,
      badge: counts.customerActive || undefined,
    },
    { href: "/dashboard/new", label: "Ajukan Keluhan", icon: <IconPlus /> },
    { href: "/settings", label: "Pengaturan", icon: <IconGear /> },
  ];
}