-- ============================================================================
-- 0003_simplify_roles.sql
--
-- Collapses `user_role` from {customer, agent, manager, admin} down to
-- {user, admin}. The whole back office is now a single admin dashboard, so
-- there is no reason to distinguish agent vs manager in the data model.
--
-- Mapping applied to existing rows:
--   customer -> user
--   agent    -> admin
--   manager  -> admin
--   admin    -> admin
--
-- NOTE: `message_author_role` is deliberately left alone. It records who wrote
-- a chat message ('customer' | 'agent' | 'system'), which is a different axis
-- from the account role and is still a useful distinction in the thread.
--
-- Run AFTER 0001 (and 0002, if you applied it). Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rebuild the enum. Postgres cannot drop enum values in place, so we create
--    a replacement type, convert the column, then swap names.
-- ---------------------------------------------------------------------------
do $$
begin
  -- Only do the swap if the old shape is still present.
  if exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'user_role' and e.enumlabel = 'customer'
  ) then

    create type user_role_new as enum ('user', 'admin');

    -- Drop every policy/function that mentions user_role first so the type can
    -- be swapped without dependency errors, then recreate them below.
    drop policy if exists profiles_self_read   on public.profiles;
    drop policy if exists profiles_peer_read   on public.profiles;
    drop policy if exists profiles_self_update on public.profiles;
    drop policy if exists profiles_self_insert on public.profiles;
    drop policy if exists sla_admin_write      on public.sla_policy;

    drop function if exists public.current_role_name() cascade;
    drop function if exists public.is_staff()         cascade;
    drop function if exists public.is_admin()         cascade;

    -- Convert the stored data onto the new type.
    alter table public.profiles
      alter column role drop default;

    alter table public.profiles
      alter column role type text;

    update public.profiles
       set role = case
                    when role = 'customer' then 'user'
                    else 'admin'
                  end;

    alter table public.profiles
      alter column role type user_role_new
      using role::user_role_new;

    alter table public.profiles
      alter column role set default 'user';

    -- Swap names.
    drop type user_role;
    alter type user_role_new rename to user_role;

  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Recreate the helper functions against the new enum.
--    `is_staff` no longer means "agent/manager/admin" — everyone who is not a
--    plain user is admin, so it is simply "is an admin".
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

-- Kept as a separate name for readability in policies, but it now just means
-- "is a back-office user", i.e. an admin.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin();
$$;

alter function public.current_role_name() owner to postgres;
alter function public.is_admin()         owner to postgres;
alter function public.is_staff()         owner to postgres;

revoke all on function public.current_role_name() from public;
revoke all on function public.is_admin()         from public;
revoke all on function public.is_staff()         from public;
grant execute on function public.current_role_name() to authenticated, anon;
grant execute on function public.is_admin()         to authenticated, anon;
grant execute on function public.is_staff()         to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Recreate the policies (same rules as before, no self-reference).
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_self_read on public.profiles
  for select to authenticated using (
    id = auth.uid() or public.is_admin()
  );

create policy profiles_peer_read on public.profiles
  for select to authenticated using (
    exists (
      select 1 from public.tickets t
      where (t.customer_id = auth.uid() and t.assignee_id = profiles.id)
         or (t.assignee_id = auth.uid() and t.customer_id = profiles.id)
    )
  );

create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (id = auth.uid() and role = public.current_role_name())
  );

create policy profiles_self_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

create policy sla_admin_write on public.sla_policy
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. `handle_new_user()` default role is now 'user'.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role user_role := 'user';
begin
  insert into public.profiles (id, email, full_name, role, company, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    v_role,
    new.raw_user_meta_data->>'company',
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;
  return new;
end $$;

alter function public.handle_new_user() owner to postgres;

-- ---------------------------------------------------------------------------
-- 5. Promote yourself. Replace the address, then run this on its own.
-- ---------------------------------------------------------------------------
-- update public.profiles set role = 'admin' where email = 'you@example.com';

-- Verify:
--   select role, count(*) from public.profiles group by role;
