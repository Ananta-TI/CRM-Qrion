import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Serverless fallback for Supabase projects where pg_cron is not enabled.
 * Protect it with `CRON_SECRET`; Vercel sends it as a bearer token when the
 * variable is configured for the project.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("auto_close_stale_tickets", {
      p_days: 3,
    });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ closed: data ?? 0 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Auto-close failed." },
      { status: 500 },
    );
  }
}
