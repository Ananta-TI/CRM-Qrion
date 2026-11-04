-- ============================================================================
-- 0005_get_my_profile.sql
--
-- Why this exists — measured, not theoretical.
--
-- Resolving the signed-in user used to take two serial Supabase round-trips:
--
--     supabase.auth.getUser()          -- HTTP /auth/v1/user   (~380ms warm)
--     .from("profiles").select("*")    -- HTTP /rest/v1/profiles (~230ms warm)
--
-- and the sidebar badges added a third (a `tickets` count). On this project
-- (region Singapore) a cold query costs roughly 250-700ms, so the shell alone
-- paid ~1.2s before a page even ran its own query. Serial and parallel variants
-- cost about the same, which points at per-query cold start rather than
-- concurrency; the fix is therefore fewer round-trips, not caching.
--
-- `get_my_profile()` collapses the first two calls into one. It is `security
-- definer` so it can read the caller's own row without re-entering the
-- `profiles` RLS policies (which historically caused recursion), and it is
-- keyed strictly on `auth.uid()`, so it can only ever return the caller's row.
-- When there is no session, `auth.uid()` is null and the function returns no
-- rows — which the app treats exactly like "no user".
--
-- Session validity is still enforced: PostgREST verifies the JWT before the
-- function runs, and `auth.uid()` is derived from that verified token.
--
-- `get_nav_counts()` is the badge counterpart, also keyed on `auth.uid()`. The
-- layout fires it alongside `get_my_profile()`, so the shell costs one
-- round-trip instead of three.
--
-- Run after 0001..0004. Idempotent.
-- ============================================================================

create or replace function public.get_my_profile()
returns setof public.profiles
language sql
security definer
set search_path = public
stable
as $$
  select *
  from public.profiles
  where id = auth.uid()
  limit 1;
$$;

comment on function public.get_my_profile() is
  'The caller''s own profile row (auth.uid()). One round-trip replacement for auth.getUser() + profiles select.';

revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;

-- Sidebar badge counts for the caller: their own active tickets (customer view)
-- and the whole open queue (staff view). The client picks the one it needs from
-- the role it already has, so no extra round-trip is spent deciding.
create or replace function public.get_nav_counts()
returns table (customer_active bigint, staff_open bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from public.tickets
      where customer_id = auth.uid()
        and status in ('Open', 'In Progress')) as customer_active,
    (select count(*) from public.tickets
      where status = 'Open') as staff_open;
$$;

comment on function public.get_nav_counts() is
  'Badge counts for the caller in one round-trip: their active tickets and the open queue.';

revoke all on function public.get_nav_counts() from public;
grant execute on function public.get_nav_counts() to authenticated;

-- Verify:
--   select * from public.get_my_profile();
--   select * from public.get_nav_counts();

