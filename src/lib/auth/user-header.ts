/**
 * Request header that carries the verified caller's id from `proxy.ts` to the
 * render pass.
 *
 * Lives in its own module so `lib/auth/session.ts` does not have to import the
 * proxy (and with it `next/server` + the Supabase SSR client) just to read the
 * name of a header.
 */
export const USER_HEADER = "x-qrion-user-id";