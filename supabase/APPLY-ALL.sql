-- ============================================================================
-- APPLY-ALL.sql  -  paste this whole file into the Supabase SQL Editor once.
--
-- Contains, in order:
--   0004_ticket_attachments.sql      (tickets.attachments column + bucket)
--   0005_get_my_profile.sql          (single round-trip session + badges)
--   0006_repair_tickets_policies.sql (restore the missing tickets INSERT policy)
--   0007_notifications.sql           (event feed index + system-message policy)
--
-- All four are idempotent, so running this more than once is safe.
-- 0006 is the one that fixes "new row violates row-level security policy".
-- ============================================================================

-- ============================================================================
-- 0004_ticket_attachments.sql
--
-- Two things the "write it like an email" flow needs:
--
--   1. a place to hang the files a user attaches when first filing a
--      complaint (the chat thread already had `messages.attachments`, the
--      ticket itself did not), and
--   2. a Supabase Storage bucket to actually hold the bytes, with policies
--      that let a signed-in user upload and read only their own ticket's
--      files.
--
-- Run after 0001..0003. Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Attachments on the ticket itself.
--    Shape: [{ path, name, mime, size }]  (path = object key in the bucket)
-- ---------------------------------------------------------------------------
alter table public.tickets
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.tickets.attachments is
  'Files attached at submission time. Rows: {path,name,mime,size}.';

-- ---------------------------------------------------------------------------
-- 2. Storage bucket.
--    Private bucket: files are served through short-lived signed URLs, which
--    the app mints on the server after it has checked ticket access.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments',
  'ticket-attachments',
  false,
  10485760, -- 10 MB per file
  array['image/png','image/jpeg','image/webp','image/gif','application/pdf']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = excluded.public;

-- ---------------------------------------------------------------------------
-- 3. Storage policies.
--    Objects are keyed  <ticket_id>/<timestamp>-<random>.<ext>
--    so the first path segment is the ticket the file belongs to.
--    `storage.foldername(name)` returns the folder parts as an array; [1] is
--    the first one.
-- ---------------------------------------------------------------------------

-- A signed-in user may read files for a ticket they can access.
drop policy if exists ticket_files_read on storage.objects;
create policy ticket_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and public.can_access_ticket((storage.foldername(name))[1]::uuid)
  );

-- A signed-in user may upload into a ticket they can access.
drop policy if exists ticket_files_insert on storage.objects;
create policy ticket_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ticket-attachments'
    and public.can_access_ticket((storage.foldername(name))[1]::uuid)
  );

-- Admins (back office) may remove files.
drop policy if exists ticket_files_delete on storage.objects;
create policy ticket_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and public.is_admin()
  );

-- ---------------------------------------------------------------------------
-- 4. Let the very first upload happen.
--    `can_access_ticket` checks the ticket row exists and belongs to the
--    caller, so it already covers the "file the ticket, then upload" order.
--    Nothing else to do.
-- ---------------------------------------------------------------------------

-- Verify:
--   select id, public, file_size_limit from storage.buckets
--    where id = 'ticket-attachments';


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



-- ============================================================================
-- 0006_repair_tickets_policies.sql
--
-- Fixes:  "new row violates row-level security policy for table \"tickets\""
--         (Postgres code 42501) when a customer submits a complaint.
--
-- Diagnosis (measured against the live project, not guessed):
--
--   * SELECT on `tickets` as a signed-in user  ............ works
--   * INSERT a `profiles` row as the same user ............ reaches the PK
--                                                           (23505 duplicate),
--                                                           so profiles RLS runs
--   * INSERT a `tickets` row as the same user ............. 42501 every time,
--                                                           even with the
--                                                           minimal payload
--                                                           (customer_id = uid)
--   * INSERT a `tickets` row with the service role ........ works
--
--   Same user, same `auth.uid()`, table is healthy, and the profiles policy
--   fires but the tickets one does not. That means the `tickets` table has a
--   SELECT policy but NO insert policy for `authenticated` — migration 0001
--   was applied only in part, or the policy was later dropped. `0001_init.sql`
--   does define `tickets_customer_insert`; it is simply not present in the DB.
--
-- This file recreates the whole `tickets` policy set so the table matches
-- 0001 again. Idempotent — safe to run more than once.
-- ============================================================================

-- A customer files a complaint under their own id.
drop policy if exists tickets_customer_insert on public.tickets;
create policy tickets_customer_insert on public.tickets
  for insert to authenticated
  with check (customer_id = auth.uid());

-- A customer reads their own tickets; staff read all.
drop policy if exists tickets_read on public.tickets;
create policy tickets_read on public.tickets
  for select to authenticated
  using (customer_id = auth.uid() or public.is_staff());

-- Customer or staff may update; the row stays owned by the customer.
drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets
  for update to authenticated
  using (customer_id = auth.uid() or public.is_staff())
  with check (customer_id = auth.uid() or public.is_staff());

-- Only admins delete.
drop policy if exists tickets_admin_delete on public.tickets;
create policy tickets_admin_delete on public.tickets
  for delete to authenticated using (public.is_admin());

-- The app also inserts into messages and ticket_events right after the ticket,
-- so repair those insert policies in the same pass in case they drifted too.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated with check (
    public.can_access_ticket(ticket_id)
    and author_id = auth.uid()
    and (
      (author_role = 'customer' and exists (
        select 1 from public.tickets t
        where t.id = ticket_id and t.customer_id = auth.uid()))
      or (author_role in ('agent','system') and public.is_staff())
    )
  );

drop policy if exists events_insert on public.ticket_events;
create policy events_insert on public.ticket_events
  for insert to authenticated with check (
    public.can_access_ticket(ticket_id) and actor_id = auth.uid()
  );

-- Verify (run separately, after the above):
--   select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename in ('tickets','messages','ticket_events')
--    order by tablename, cmd;

-- ============================================================================
-- 0007_notifications.sql
--
-- Global event feed index for the notification bell + system-message insert
-- policy so staff can post author-less system notices.
-- ============================================================================

create index if not exists ticket_events_created_idx
  on public.ticket_events(created_at desc);

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated with check (
    public.can_access_ticket(ticket_id)
    and (
      (
        author_id = auth.uid()
        and (
          (author_role = 'customer' and exists (
            select 1 from public.tickets t
            where t.id = ticket_id and t.customer_id = auth.uid()))
          or (author_role in ('agent', 'system') and public.is_staff())
        )
      )
      or (
        author_id is null
        and author_role = 'system'
        and public.is_staff()
      )
    )
  );
