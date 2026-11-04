import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { SUPABASE_URL, env } from "./env";

/**
 * Privileged client using the service_role key.
 *
 * This BYPASSES Row Level Security. Only use it in server actions that have
 * already checked the caller with `requireAdmin()`. It exists so an admin can
 * create back-office or customer accounts from inside the app.
 */
export function createAdminClient() {
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local to enable " +
        "account provisioning. Find it under Supabase Dashboard > Project " +
        "Settings > API > service_role secret.",
    );
  }

  return createSupabaseClient<Database>(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const isAdminClientConfigured = () =>
  Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
