-- ============================================================================
-- 0002_fix_profiles_recursion.sql
--
-- Fixes:  "infinite recursion detected in policy for relation \"profiles\""
--
-- Cause:  the `profiles_self_update` policy contained a sub-select against
--         `public.profiles` directly. Evaluating the policy for `profiles`
--         therefore required reading `profiles`, which re-evaluated the same
--         policy -> recursion.
--
-- Fix:    (a) replace the raw sub-select with the already-`security definer`
--             helper `public.current_role_name()`, which reads `profiles`
--             outside RLS, and
--         (b) harden the three helper functions: force them to run as the
--             table owner (`postgres`, which has BYPASSRLS) and keep
--             `search_path` pinned so they can never be hijacked.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Harden the helper functions.
--
--    `security definer` alone is not enough if the function is owned by a role
--    that is itself subject to RLS. Re-create them owned by the migration
--    runner (in the Supabase SQL Editor that is `postgres`, which bypasses
--    RLS), and lock down who may execute them.
-- ---------------------------------------------------------------------------
create or replace function public.current_role_name()
returns user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role in ('agent','manager','admin') from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- Owned by postgres (BYPASSRLS) in the SQL Editor; harmless if already so.
alter function public.current_role_name() owner to postgres;
alter function public.is_staff()         owner to postgres;
alter function public.is_admin()         owner to postgres;

revoke all on function public.current_role_name() from public;
revoke all on function public.is_staff()         from public;
revoke all on function public.is_admin()         from public;
grant execute on function public.current_role_name() to authenticated, anon;
grant execute on function public.is_staff()         to authenticated, anon;
grant execute on function public.is_admin()         to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. Rebuild the `profiles` policies without any self-reference.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_self_read   on public.profiles;
drop policy if exists profiles_peer_read   on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_admin_write on public.profiles;

-- Read: yourself, or any profile if you are staff.
create policy profiles_self_read on public.profiles
  for select to authenticated using (
    id = auth.uid() or public.is_staff()
  );

-- Read: a customer may see the agent handling their ticket and vice-versa.
create policy profiles_peer_read on public.profiles
  for select to authenticated using (
    exists (
      select 1 from public.tickets t
      where (t.customer_id = auth.uid() and t.assignee_id = profiles.id)
         or (t.assignee_id = auth.uid() and t.customer_id = profiles.id)
    )
  );

-- Update: the owner may edit their own row, but cannot change their role;
-- an admin may change anything. Role comparison goes through the definer
-- helper, never a raw sub-select on `profiles`.
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (id = auth.uid() and role = public.current_role_name())
  );

-- Insert: normally done by the `handle_new_user()` trigger (definer); allow an
-- owner to upsert their own row defensively, but never a foreign one.
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Verify (should return zero rows).
-- ---------------------------------------------------------------------------
-- select policyname, qual, with_check from pg_policies
--   where schemaname = 'public' and tablename = 'profiles';
