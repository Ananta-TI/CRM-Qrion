import { redirect } from "next/navigation";

import { getSession, homeFor } from "@/lib/auth/session";

/**
 * The sign-in redirect at the root. `proxy.ts` already bounces anonymous
 * visitors to /login, so reaching here means there is a session to route.
 */
export default async function RootPage() {
  const session = await getSession();
  redirect(session ? homeFor(session.profile.role) : "/login");
}
