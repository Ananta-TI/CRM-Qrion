import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { Profile, UserRole } from "@/lib/types/database";
import { createClient } from "@/lib/supabase/server";

export type Session = {
  userId: string;
  email: string;
  profile: Profile;
};

const STAFF_ROLES: UserRole[] = ["admin"];

/**
 * Resolve the signed-in user plus their profile row in ONE Supabase round-trip.
 * `cache()` dedupes the work across a single render pass.
 *
 * Why not `auth.getUser()` + a `profiles` select: measured on this project
 * (region Singapore) those are two serial round-trips, and the auth call alone
 * costs ~380ms even warm, with the profiles read ~230ms on top — so the shell
 * paid ~0.5-1.1s before any page ran its own query. `get_my_profile()` returns
 * the caller's row keyed on `auth.uid()` in a single request. Session validity
 * is unchanged: PostgREST verifies the JWT before the function runs.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_my_profile");

  // PGRST202 = the function is not in the schema cache. That means migration
  // 0005 has not been applied yet; fall back to the slower two-call path so the
  // app keeps working instead of bouncing signed-in users to /login.
  if (error?.code === "PGRST202") {
    return getSessionFallback(supabase);
  }

  if (error) return null;

  // A setof function returns an array; take the single row (uid guarantees at
  // most one).
  const profile = Array.isArray(data) ? (data[0] as Profile | undefined) : undefined;
  if (!profile) return null;

  return { userId: profile.id, email: profile.email, profile };
});

/** The pre-0005 path: `auth.getUser()` then a `profiles` select. */
async function getSessionFallback(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Session | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return { userId: user.id, email: user.email ?? profile.email, profile };
}

/** Redirect to /login when there is no session. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Redirect back-office users to their own area. */
export async function requireCustomer(): Promise<Session> {
  const session = await requireSession();
  if (isStaff(session.profile.role)) redirect("/agent");
  return session;
}

/** Redirect plain users away from the internal back office. */
export async function requireStaff(): Promise<Session> {
  const session = await requireSession();
  if (!isStaff(session.profile.role)) redirect("/dashboard");
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.profile.role !== "admin") redirect("/dashboard");
  return session;
}

export function isStaff(role: UserRole): boolean {
  return STAFF_ROLES.includes(role);
}

/** Where a given role should land after signing in. */
export function homeFor(role: UserRole): string {
  return role === "admin" ? "/agent" : "/dashboard";
}
