import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

import { USER_HEADER } from "@/lib/auth/user-header";

/*
 * The verified caller's id travels to the render pass as the `USER_HEADER`
 * request header.
 *
 * The proxy has already proven this value (see `auth.getClaims()` below), so a
 * page can key its own query on it immediately instead of first waiting for
 * `get_my_profile()`. Every request re-sets the header, so a client cannot
 * smuggle one in.
 *
 * Forging it would not leak anything: PostgREST authorizes from the JWT, not
 * from this header. The worst a forged value could do is select a narrower (or
 * equally allowed) slice of the rows RLS already permits.
 */

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

/**
 * Next.js 16 renamed `middleware` to `proxy`. The runtime is always Node.js.
 *
 * Two jobs:
 *   1. keep the Supabase session cookies fresh on every request,
 *   2. do the cheap "is anyone signed in?" redirect so protected pages never
 *      flash their content.
 *
 * Real authorization (which role may open which page) lives in the page-level
 * `require*()` helpers, because it needs a database lookup.
 */
export async function proxy(request: NextRequest) {
  // Cookies refreshed during this request. They are buffered instead of being
  // written straight into a response, because the response must be built AFTER
  // we know who the caller is (see `USER_HEADER` below).
  let refreshed: PendingCookie[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          refreshed = cookiesToSet;
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
        },
      },
    },
  );

  /*
   * `getClaims()` instead of `getUser()`: the access token is an ES256 JWT, so
   * claims are verified locally against the project's JWKS (fetched once, then
   * cached in-process). Measured on this machine the old `getUser()` call was a
   * 271-463ms network round-trip to /auth/v1/user on EVERY request — it was the
   * single largest slice of a 1202ms page navigation, and it ran again for each
   * server action (including the 60s notification poll).
   *
   * Session freshness is unchanged: `getClaims()` reads the session through
   * `getSession()`, which still refreshes an expired token and hands the new
   * cookies to `setAll` above.
   */
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsError ? null : (claimsData?.claims?.sub ?? null);

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/register");

  // Schedulers (Vercel Cron, uptime pings) are not browsers: they carry no
  // session cookie and expect a status code, not an HTML login form. The route
  // does its own `CRON_SECRET` check, so it must be reachable while signed out.
  const isMachineRoute = pathname.startsWith("/api/cron");

  const withCookies = (response: NextResponse) => {
    for (const { name, value, options } of refreshed) {
      response.cookies.set(name, value, options);
    }
    return response;
  };

  if (!userId && !isAuthRoute && !isMachineRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return withCookies(NextResponse.redirect(url));
  }

  if (userId && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return withCookies(NextResponse.redirect(url));
  }

  // Overwrite (never merely add) the header so the render pass can trust it.
  request.headers.delete(USER_HEADER);
  if (userId) request.headers.set(USER_HEADER, userId);

  return withCookies(NextResponse.next({ request }));
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimization. The public
     * landing page is included so a signed-in visitor is bounced to their
     * dashboard.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};