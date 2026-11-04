import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Cache Components stays OFF, and this is a measured decision, not a default.
   *
   * Every route here sits behind Supabase auth and renders per-user data, so
   * nothing can prerender into a static shell: each page starts with
   * `requireSession()` -> `createClient()` -> `cookies()`. Enabling the flag
   * would only push the same cookie + query work behind Suspense boundaries,
   * without making any query faster.
   *
   * Measured on this machine (project region: Singapore, cf-ray ...-SIN):
   *   raw HEAD to Supabase ................  49ms
   *   one `profiles` select ............... 715ms  (cold)
   *   serial auth + profile + tickets ..... 1220ms
   *   the same three queries in parallel ...  618ms
   *
   * Serial and parallel cost about the same, which points at per-query cold
   * start on the Supabase side rather than request concurrency. That is the
   * real cost of a navigation, and no rendering-model change removes it. The
   * fix is fewer round-trips per page, which is why the session and the badge
   * counts were moved into single RPCs (see supabase/migrations/0005):
   *
   *   auth.getUser() + profiles select (2 round-trips) ...  ~470-1100ms
   *   get_my_profile() + get_nav_counts() (parallel) .....  ~250-360ms
   */
  partialPrefetching: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
