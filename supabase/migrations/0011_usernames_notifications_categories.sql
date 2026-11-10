-- ============================================================================
-- 0011_usernames_notifications_categories.sql
--
-- Three product requirements that all need database backing:
--
--   1. Username accounts. Employees and programmers can sign in with either
--      their email or a username. Usernames are stored lowercase and are
--      unique case-insensitively. The profile trigger reads `username` from
--      auth metadata, and existing auth users are backfilled here.
--
--   2. Programmer account notifications. `ticket_events` cannot represent an
--      account change because it requires a ticket id, so this adds a small
--      generic `notifications` table plus `notify_programmers()`. The RPC is
--      SECURITY DEFINER so it can fan out to every programmer, but it refuses
--      to run for non-programmers.
--
--   3. Server / Keuangan issue categories selected by the employee. The old
--      categories stay in the constraint so historical rows continue to
--      validate.
--
-- Also tightens two self-service columns: a user may edit their own username,
-- email and password, but cannot flip their own role or active flag through a
-- direct REST call. Email must match the verified auth email first.
--
-- Run after 0010. Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Username columns, backfill and format guard.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists username text;

comment on column public.profiles.username is
  'Optional lowercase login handle. Unique case-insensitively; may be changed by its owner.';

-- Pull usernames from the auth metadata of accounts provisioned before this
-- migration. Two accounts may share a metadata username; only the first gets
-- it so the unique index below cannot fail.
with candidates as (
  select
    u.id,
    lower(trim(u.raw_user_meta_data->>'username')) as username,
    row_number() over (
      partition by lower(trim(u.raw_user_meta_data->>'username'))
      order by u.created_at, u.id
    ) as rn
  from auth.users u
  where nullif(trim(u.raw_user_meta_data->>'username'), '') is not null
    and lower(trim(u.raw_user_meta_data->>'username')) ~ '^[a-z0-9][a-z0-9._-]{2,31}$'
)
update public.profiles p
   set username = c.username
  from candidates c
 where p.id = c.id
   and p.username is null
   and c.rn = 1
   and not exists (
     select 1
     from public.profiles q
     where lower(q.username) = c.username
       and q.id <> p.id
   );

do $$ begin
  alter table public.profiles
    add constraint profiles_username_format check (
      username is null
      or (
        username = lower(username)
        and username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'
      )
    );
exception when duplicate_object then null; end $$;

create unique index if not exists profiles_username_key
  on public.profiles (lower(username))
  where username is not null;

-- ---------------------------------------------------------------------------
-- 2. New signup trigger: carry `username` from metadata into the profile.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text;
begin
  -- Invalid handles are ignored rather than failing signup; the app validates
  -- the field before it gets here.
  v_username := nullif(lower(trim(new.raw_user_meta_data->>'username')), '');
  if v_username is not null
     and v_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    v_username := null;
  end if;

  insert into public.profiles (
    id, email, full_name, role, company, phone, username
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'user',
    new.raw_user_meta_data->>'company',
    new.raw_user_meta_data->>'phone',
    v_username
  )
  on conflict (id) do nothing;

  return new;
end $$;

alter function public.handle_new_user() owner to postgres;

-- Keep `profiles.email` in step when the auth email changes (self-service
-- email update, or an admin changing it through the Auth API).
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles
     set email = new.email
   where id = new.id
     and email is distinct from new.email;
  return new;
end $$;

alter function public.sync_profile_email() owner to postgres;
revoke all on function public.sync_profile_email() from public;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- ---------------------------------------------------------------------------
-- 3. Self-service guard.
--
--    `profiles_self_update` intentionally lets the owner edit their row. This
--    trigger closes the columns that must not be self-service: role, active
--    flag, and an email that does not match the verified auth email yet.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() = old.id and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Role akun tidak dapat diubah sendiri.'
        using errcode = '42501';
    end if;

    if new.is_active is distinct from old.is_active then
      raise exception 'Status akun tidak dapat diubah sendiri.'
        using errcode = '42501';
    end if;

    if new.email is distinct from old.email
       and new.email is distinct from (
         select u.email from auth.users u where u.id = old.id
       ) then
      raise exception 'Email harus diubah melalui pengaturan akun.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

alter function public.guard_profile_self_update() owner to postgres;
revoke all on function public.guard_profile_self_update() from public;

drop trigger if exists profiles_guard_self_update on public.profiles;
create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function public.guard_profile_self_update();

-- ---------------------------------------------------------------------------
-- 4. Username → email lookup for the login form.
--
--    The anon role cannot read `profiles`, so username sign-in needs a narrow
--    SECURITY DEFINER lookup. It returns only the email address; the password
--    is still verified by Supabase Auth. Inactive accounts resolve to null.
-- ---------------------------------------------------------------------------
create or replace function public.email_for_username(p_username text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.email
  from public.profiles p
  where lower(p.username) = lower(trim(p_username))
    and p.is_active
  limit 1;
$$;

comment on function public.email_for_username(text) is
  'Resolve a username to its login email. No password material; inactive accounts return null.';

revoke all on function public.email_for_username(text) from public;
grant execute on function public.email_for_username(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Generic account notifications.
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id     uuid references public.profiles(id) on delete set null,
  kind         text not null default 'account',
  title        text not null check (char_length(trim(title)) between 1 and 160),
  body         text,
  href         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications(recipient_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_self_read on public.notifications;
create policy notifications_self_read on public.notifications
  for select to authenticated
  using (recipient_id = auth.uid());

drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Insert only through the RPC below. There is deliberately no INSERT policy.
create or replace function public.notify_programmers(
  p_kind text,
  p_title text,
  p_body text default null,
  p_href text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Hanya programmer yang dapat mengirim notifikasi.'
      using errcode = '42501';
  end if;

  if nullif(trim(p_title), '') is null then
    raise exception 'Judul notifikasi wajib diisi.';
  end if;

  insert into public.notifications (
    recipient_id, actor_id, kind, title, body, href
  )
  select
    p.id,
    auth.uid(),
    coalesce(nullif(trim(p_kind), ''), 'account'),
    left(trim(p_title), 160),
    nullif(trim(p_body), ''),
    nullif(trim(p_href), '')
  from public.profiles p
  where p.role = 'admin'
    and p.is_active;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function public.notify_programmers(text, text, text, text) is
  'Fan out an account notification to every active programmer. Caller must be a programmer.';

revoke all on function public.notify_programmers(text, text, text, text) from public;
grant execute on function public.notify_programmers(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Employee-selectable categories.
-- ---------------------------------------------------------------------------
alter table public.tickets
  drop constraint if exists tickets_category_check;

alter table public.tickets
  add constraint tickets_category_check check (
    category in (
      'Server',
      'Teknis',
      'Keuangan',
      'Akun',
      'Transaksi',
      'Pembayaran',
      'Pengiriman',
      'Produk',
      'Lainnya'
    )
  );

-- Verify (run separately):
--   select username, email, role from public.profiles order by username nulls last;
--   select public.email_for_username('bang.ridho');
--   select * from public.notifications order by created_at desc limit 10;
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.tickets'::regclass and conname = 'tickets_category_check';
