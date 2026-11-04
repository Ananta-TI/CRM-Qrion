import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { buildNav, EMPTY_COUNTS, type NavCounts } from "@/lib/auth/nav";
import { getSession, isStaff } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/database";

/**
 * The signed-in frame: sidebar + persistent header live here, so they stay
 * mounted across navigations and only the page content swaps. Pages no longer
 * render <AppShell> themselves.
 *
 * The session is resolved with `getSession()`, which is `cache()`d — the page
 * below calls `requireXxx()`, which reuses that same result, so this layout
 * adds no extra auth round-trip.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Badges come from one RPC keyed on auth.uid(), so it does not need the role
  // first — it can run alongside the profile fetch instead of after it.
  const counts = await navCounts(session.profile.role);
  const nav = buildNav(session.profile.role, counts);

  return (
    <AppShell profile={session.profile} nav={nav}>
      {children}
    </AppShell>
  );
}

/**
 * Sidebar badge counts in a single round-trip (`get_nav_counts()`). Falls back
 * to a plain count query when migration 0005 has not been applied yet, and
 * degrades to no badge on any error — a badge must never break the page.
 */
async function navCounts(role: UserRole): Promise<NavCounts> {
  const supabase = await createClient();

  try {
    const { data, error } = await supabase.rpc("get_nav_counts");

    if (error?.code === "PGRST202") {
      return navCountsFallback(supabase, role);
    }
    if (error || !data) return EMPTY_COUNTS;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return EMPTY_COUNTS;

    return {
      customerActive: Number(row.customer_active ?? 0),
      staffOpen: Number(row.staff_open ?? 0),
    };
  } catch {
    return EMPTY_COUNTS;
  }
}

/** The pre-0005 path: a `tickets` count query for the relevant badge. */
async function navCountsFallback(
  supabase: Awaited<ReturnType<typeof createClient>>,
  role: UserRole,
): Promise<NavCounts> {
  try {
    if (isStaff(role)) {
      const { count } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("status", "Open");
      return { ...EMPTY_COUNTS, staffOpen: count ?? 0 };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return EMPTY_COUNTS;

    const { count } = await supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", user.id)
      .in("status", ["Open", "In Progress"]);
    return { ...EMPTY_COUNTS, customerActive: count ?? 0 };
  } catch {
    return EMPTY_COUNTS;
  }
}
