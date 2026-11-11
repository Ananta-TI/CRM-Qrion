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

  experimental: {
    /*
     * Since Next 15 `staleTimes.dynamic` defaults to 0, which means a dynamic
     * page is NEVER reused from the client cache: every click pays the full
     * server round-trip again, and the prefetched shell can only ever show the
     * skeleton. Measured before this change (production build, /agent ->
     * /agent/analytics): click-to-title 1202ms, of which 1161ms was the RSC
     * fetch — proxy `auth.getUser()` ~350ms + `get_my_profile()` ~350ms +
     * the page's own query ~450ms.
     *
     * 30s is the old v14 default. Long enough that moving around the app feels
     * instant, short enough that a stale ticket status corrects itself; every
     * mutation still calls `router.refresh()`, which drops the entry.
     *
     * `static` is cut to 60s (default 5 min) because the sidebar links use
     * `prefetch={true}`: those full-page prefetches are cached under the static
     * TTL, and a ticket board that is 5 minutes stale is worse than a refetch.
     */
    staleTimes: {
      dynamic: 30,
      static: 60,
    },
  },
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
