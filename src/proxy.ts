import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

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
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/register");

  // Schedulers (Vercel Cron, uptime pings) are not browsers: they carry no
  // session cookie and expect a status code, not an HTML login form. The route
  // does its own `CRON_SECRET` check, so it must be reachable while signed out.
  const isMachineRoute = pathname.startsWith("/api/cron");

  if (!user && !isAuthRoute && !isMachineRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
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
