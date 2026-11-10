-- ============================================================================
-- APPLY-ALL.sql  -  paste this whole file into the Supabase SQL Editor once.
--
-- Contains, in order (migrations 0004-0011; run 0001-0003 first on a fresh
-- database):
--   0004_ticket_attachments.sql      (tickets.attachments column + bucket)
--   0005_get_my_profile.sql          (single round-trip session + badges)
--   0006_repair_tickets_policies.sql (restore the missing tickets INSERT policy)
--   0007_notifications.sql           (event feed index + system-message policy)
--   0008_operational_hardening.sql   (notification read state, SLA pause,
--                                     analytics fix, auto-close + pg_cron)
--   0009_security_fixes.sql          (knowledge-view RLS + nav-count gating)
--   0010_programmer_assignment.sql   (programmer assignment RLS + drop the
--                                     unused knowledge view)
--   0011_usernames_notifications_categories.sql
--                                    (username login, self-service
--                                     credentials, account notifications,
--                                     Server/Keuangan categories)
--
-- Every statement in this file is idempotent, so running it more than once is
-- safe. 0006 is the one that fixes "new row violates row-level security policy".
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


-- ============================================================================
-- 0008_operational_hardening.sql
--
-- Operational fixes that need to live in Postgres, not just in the UI:
--
--   1. Notification read state on `profiles`, so it syncs across devices.
--   2. SLA pause/resume bookkeeping while the ticket is waiting on the
--      customer (agent replied, or status is Waiting Validation).
--   3. `ticket_knowledge.hours_to_close` excludes paused time.
--   4. `refresh_sla_breaches()` ignores paused tickets.
--   5. Auto-close tickets that have waited more than 3 days for validation,
--      with a pg_cron job when the extension is available.
--
-- Run after 0001..0007. Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Notification read state (profile-level, not browser-level)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists notifications_seen_at timestamptz;

comment on column public.profiles.notifications_seen_at is
  'Last time this user opened the notification bell. Synced across devices.';

-- ---------------------------------------------------------------------------
-- 2. SLA pause bookkeeping
--    sla_paused_at      = the clock is currently stopped since this instant
--    sla_paused_minutes = completed pause time, subtracted from analytics
-- ---------------------------------------------------------------------------
alter table public.tickets
  add column if not exists sla_paused_at timestamptz,
  add column if not exists sla_paused_minutes int not null default 0;

comment on column public.tickets.sla_paused_at is
  'When the current customer-wait period started; null when the SLA clock is running.';
comment on column public.tickets.sla_paused_minutes is
  'Completed customer-wait minutes. Excluded from SLA reporting.';

-- Stop the clock. Repeated calls are harmless.
create or replace function public.pause_ticket_sla(p_ticket uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.tickets
     set sla_paused_at = now()
   where id = p_ticket
     and status <> 'Closed'
     and sla_paused_at is null;
end $$;

-- Restart the clock and push the deadline forward by exactly the time spent
-- waiting. Repeated calls are harmless.
create or replace function public.resume_ticket_sla(p_ticket uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paused_at timestamptz;
  v_seconds int;
begin
  select sla_paused_at into v_paused_at
    from public.tickets
   where id = p_ticket;

  if v_paused_at is null then
    return;
  end if;

  v_seconds := greatest(0, floor(extract(epoch from (now() - v_paused_at)))::int);

  update public.tickets
     set sla_paused_minutes = sla_paused_minutes + (v_seconds / 60),
         sla_deadline = case
           when sla_deadline is null then null
           else sla_deadline + make_interval(secs => v_seconds)
         end,
         sla_paused_at = null
   where id = p_ticket
     and sla_paused_at = v_paused_at;
end $$;

-- These are internal helpers. Do not let clients manipulate their own SLA.
revoke all on function public.pause_ticket_sla(uuid) from public;
revoke all on function public.resume_ticket_sla(uuid) from public;

-- ---------------------------------------------------------------------------
-- 2a. The SLA lifecycle trigger
--     Waiting Validation means the ball is in the customer's court. Any other
--     status means the agent is working.
-- ---------------------------------------------------------------------------
create or replace function public.tickets_sla_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'Waiting Validation' then
      perform public.pause_ticket_sla(new.id);
    end if;
    return null;
  end if;

  if new.status = 'Waiting Validation'
     and old.status is distinct from 'Waiting Validation' then
    perform public.pause_ticket_sla(new.id);
  elsif old.status = 'Waiting Validation'
     and new.status is distinct from 'Waiting Validation' then
    perform public.resume_ticket_sla(new.id);
  end if;

  if new.status = 'Closed' and old.status is distinct from 'Closed' then
    perform public.resume_ticket_sla(new.id);
  end if;

  -- Reopening a closed ticket starts a new life for the SLA clock: the time it
  -- spent closed is not time the agent had to work on it. Without this, a
  -- ticket reopened on day 6 of the 7-day window would already look breached.
  if old.status = 'Closed' and new.status is distinct from 'Closed' then
    update public.tickets t
       set sla_deadline = case
             when t.sla_deadline is null then null
             else t.sla_deadline
                  + (now() - coalesce(old.closed_at, now()))
           end,
           sla_paused_minutes = t.sla_paused_minutes + greatest(
             0,
             floor(extract(epoch from (now() - coalesce(old.closed_at, now()))) / 60.0)::int
           )
     where t.id = new.id;
  end if;

  return null;
end $$;

drop trigger if exists tickets_sla_lifecycle on public.tickets;
create trigger tickets_sla_lifecycle
  after insert or update of status on public.tickets
  for each row execute function public.tickets_sla_lifecycle();

-- ---------------------------------------------------------------------------
-- 2b. A real agent reply hands the turn to the customer; a customer reply
--     hands it back. Internal notes do not move the clock.
-- ---------------------------------------------------------------------------
create or replace function public.messages_sla_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.ticket_status;
begin
  select status into v_status
    from public.tickets
   where id = new.ticket_id;

  if v_status is null or v_status = 'Closed' then
    return null;
  end if;

  if new.author_role = 'agent' and new.kind <> 'note' then
    perform public.pause_ticket_sla(new.ticket_id);
  elsif new.author_role = 'customer' then
    perform public.resume_ticket_sla(new.ticket_id);
  end if;

  return null;
end $$;

drop trigger if exists messages_sla_lifecycle on public.messages;
create trigger messages_sla_lifecycle
  after insert on public.messages
  for each row execute function public.messages_sla_lifecycle();

-- ---------------------------------------------------------------------------
-- 2c. Deadline arithmetic must include completed and currently-running pauses
--     whenever urgency/level (and therefore the policy target) changes.
-- ---------------------------------------------------------------------------
create or replace function public.tickets_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_minutes int;
  v_pause_minutes int;
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
  end if;

  -- Recompute the deadline when triage inputs change (or on first insert).
  if tg_op = 'INSERT'
     or new.urgency is distinct from old.urgency
     or new.escalation_level is distinct from old.escalation_level then

    select resolve_minutes into v_minutes
      from public.sla_policy
     where urgency = new.urgency and level = new.escalation_level;

    if v_minutes is null then
      select resolve_minutes into v_minutes
        from public.sla_policy
       where urgency = new.urgency
       order by resolve_minutes asc limit 1;
    end if;

    v_pause_minutes := coalesce(new.sla_paused_minutes, 0);
    if new.sla_paused_at is not null then
      -- Fold the currently-running pause into the completed total and restart
      -- the pause marker at `now()`. Without resetting the marker, the later
      -- resume would add this same interval to the deadline a second time.
      v_pause_minutes := v_pause_minutes + greatest(
        0,
        floor(extract(epoch from (now() - new.sla_paused_at)) / 60.0)::int
      );
      new.sla_paused_minutes := v_pause_minutes;
      new.sla_paused_at := now();
    end if;

    new.sla_policy_minutes := v_minutes;
    new.sla_deadline := new.created_at
      + make_interval(mins => coalesce(v_minutes, 1440))
      + make_interval(mins => v_pause_minutes);
  end if;

  -- Stamp lifecycle timestamps as the status moves.
  if new.status = 'Closed' and (old.status is distinct from 'Closed' or tg_op = 'INSERT') then
    new.closed_at := coalesce(new.closed_at, now());
  elsif new.status <> 'Closed' then
    new.closed_at := null;
  end if;

  if new.status = 'Waiting Validation'
     and (tg_op = 'INSERT' or old.status is distinct from 'Waiting Validation') then
    -- Each entry into the wait restarts the 3-day auto-close clock. Using
    -- coalesce here would keep a stale timestamp from the previous round and
    -- let the scheduler close a ticket the customer only just received.
    new.resolved_at := now();
  end if;

  return new;
end $$;

drop trigger if exists tickets_before_write on public.tickets;
create trigger tickets_before_write before insert or update on public.tickets
  for each row execute function public.tickets_before_write();

-- ---------------------------------------------------------------------------
-- 2d. Backfill the pause state for tickets that are already mid-conversation.
--     Existing Waiting Validation tickets have been waiting since resolved_at.
--     Existing active tickets whose last real message is from an agent are also
--     waiting on the customer.
-- ---------------------------------------------------------------------------
update public.tickets
   set sla_paused_at = coalesce(resolved_at, updated_at, now())
 where status = 'Waiting Validation'
   and sla_paused_at is null;

with last_message as (
  select distinct on (m.ticket_id)
         m.ticket_id,
         m.author_role,
         m.created_at
    from public.messages m
   where m.kind <> 'note'
   order by m.ticket_id, m.created_at desc
)
update public.tickets t
   set sla_paused_at = lm.created_at
  from last_message lm
 where lm.ticket_id = t.id
   and lm.author_role = 'agent'
   and t.status in ('Open', 'In Progress')
   and t.sla_paused_at is null;

-- ---------------------------------------------------------------------------
-- 3. Analytics: closing time excludes customer-wait time.
-- ---------------------------------------------------------------------------
create or replace view public.ticket_knowledge as
select
  t.id,
  t.ticket_code,
  t.subject,
  t.description,
  t.category,
  t.urgency,
  t.status,
  t.escalation_level,
  t.resolution_summary,
  t.tags,
  t.csat_score,
  t.reopen_count,
  t.created_at,
  t.closed_at,
  t.sla_deadline,
  t.sla_breached,
  extract(epoch from (t.closed_at - t.created_at)) / 3600.0
    - (t.sla_paused_minutes / 60.0) as hours_to_close,
  c.full_name as customer_name,
  a.full_name as agent_name
from public.tickets t
join public.profiles c on c.id = t.customer_id
left join public.profiles a on a.id = t.assignee_id;

grant select on public.ticket_knowledge to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Breach detection ignores a stopped clock.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_sla_breaches()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count int;
begin
  with hit as (
    update public.tickets
       set sla_breached = true
     where status <> 'Closed'
       and sla_paused_at is null
       and sla_deadline < now()
       and sla_breached = false
    returning 1
  )
  select count(*) into v_count from hit;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Auto-close stale "Waiting Validation" tickets after 3 days.
--    Writes an audit event and a system message, then closes the row.
-- ---------------------------------------------------------------------------
create or replace function public.auto_close_stale_tickets(p_days int default 3)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_note constant text :=
    'Sistem menutup tiket secara otomatis karena tidak ada respons pelanggan.';
begin
  with stale as (
    update public.tickets
       set status = 'Closed',
           closed_at = now(),
           resolved_at = coalesce(resolved_at, now())
     where status = 'Waiting Validation'
       and coalesce(resolved_at, updated_at, created_at)
           < now() - make_interval(days => greatest(coalesce(p_days, 3), 1))
    returning id
  ),
  closed_events as (
    insert into public.ticket_events
      (ticket_id, actor_id, event_type, from_value, to_value, note)
    select id, null, 'auto_closed', 'Waiting Validation', 'Closed', v_note
      from stale
  ),
  closed_messages as (
    insert into public.messages
      (ticket_id, author_id, author_role, kind, body)
    select id, null, 'system', 'system', v_note
      from stale
  )
  select count(*) into v_count from stale;

  return v_count;
end $$;

-- Only the scheduler (service role / pg_cron) may run a bulk close.
revoke all on function public.auto_close_stale_tickets(int) from public;
grant execute on function public.auto_close_stale_tickets(int) to service_role;

-- Schedule it when pg_cron is enabled. If the extension is missing this block
-- is a no-op; enable pg_cron under Database > Extensions and rerun, or point
-- Vercel Cron at /api/cron/auto-close instead.
do $$
declare
  v_jobid bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into v_jobid
      from cron.job
     where jobname = 'qrion-auto-close-stale-tickets';

    if v_jobid is not null then
      perform cron.unschedule(v_jobid);
    end if;

    perform cron.schedule(
      'qrion-auto-close-stale-tickets',
      '15 * * * *',
      'select public.auto_close_stale_tickets(3)'
    );
  end if;
end $$;

-- Verify:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'tickets'
--      and column_name like 'sla_paused%';
--   select jobname, schedule from cron.job
--    where jobname = 'qrion-auto-close-stale-tickets';

-- ============================================================================
-- 0009_security_fixes.sql
-- ============================================================================

alter view public.ticket_knowledge set (security_invoker = true);

comment on view public.ticket_knowledge is
  'Ticket analytics/archive. security_invoker=true: tickets and profiles RLS apply to the caller.';

grant select on public.ticket_knowledge to authenticated;

create or replace function public.get_nav_counts()
returns table (customer_active bigint, staff_open bigint)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    (select count(*) from public.tickets
      where customer_id = auth.uid()
        and status in ('Open', 'In Progress')) as customer_active,
    case
      when public.is_staff() then
        (select count(*) from public.tickets where status = 'Open')
      else 0
    end as staff_open;
$$;

comment on function public.get_nav_counts() is
  'Badge counts for the caller in one round-trip. staff_open is zero unless the caller is staff.';

revoke all on function public.get_nav_counts() from public;
grant execute on function public.get_nav_counts() to authenticated;

-- ============================================================================
-- 0010_programmer_assignment.sql
--
-- Internal helpdesk model:
--
--   * An employee (`profiles.role = 'user'`) files a ticket either to one
--     specific programmer (`assignee_id = programmer id`) or to the shared
--     queue (`assignee_id = null`, shown as "All" in the UI).
--   * A programmer (`profiles.role = 'admin'`) can read:
--       - tickets assigned to them, and
--       - unassigned tickets (the "All" target).
--     Tickets assigned to another programmer are hidden, not just filtered by
--     the app.
--   * Claiming an unassigned ticket moves it from "All" to that programmer.
--
-- The escalation feature is gone from the UI, but `tickets.escalation_level`
-- stays because the SLA trigger still reads it. Every new ticket stays at L1.
--
-- The unused Knowledge Base view is dropped here. That also closes the REST
-- leak where a customer could read every ticket through `ticket_knowledge`.
--
-- Run after 0009. Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Programmer predicate. The account role name is still `admin`; the
--    product label is "programmer". Keep the role enum unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.is_programmer(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = p_user
      and role = 'admin'
  );
$$;

comment on function public.is_programmer(uuid) is
  'True when the given profile is a programmer (role = admin). Used by assignment RLS.';

revoke all on function public.is_programmer(uuid) from public;
grant execute on function public.is_programmer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Minimal programmer directory for the new-ticket form.
--
--    Employees cannot read the `profiles` table directly (RLS only exposes
--    their own row), so this SECURITY DEFINER function returns just the fields
--    the picker needs. It deliberately does not expose email or phone.
-- ---------------------------------------------------------------------------
create or replace function public.list_programmers()
returns table (id uuid, full_name text, avatar_tint text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name, p.avatar_tint
  from public.profiles p
  where p.role = 'admin'
    and p.is_active
  order by p.full_name;
$$;

comment on function public.list_programmers() is
  'Active programmers for the ticket target picker. No email/phone.';

revoke all on function public.list_programmers() from public;
grant execute on function public.list_programmers() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Assignment-aware access check.
--
--    This function is the single gate used by tickets, messages and events
--    policies, so fixing it here keeps the whole conversation private.
-- ---------------------------------------------------------------------------
create or replace function public.can_access_ticket(p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tickets t
    where t.id = p_ticket
      and (
        t.customer_id = auth.uid()
        or t.assignee_id = auth.uid()
        or (public.is_staff() and t.assignee_id is null)
      )
  );
$$;

comment on function public.can_access_ticket(uuid) is
  'Customer owner, assigned programmer, or any programmer for the unassigned (All) queue.';

-- ---------------------------------------------------------------------------
-- 4. Ticket policies.
--
--    `tickets_customer_insert` accepts a specific programmer as the target but
--    rejects arbitrary profiles. `tickets_update` allows the customer, the
--    assignee, or a programmer acting on an unassigned ticket (claim/status).
-- ---------------------------------------------------------------------------
drop policy if exists tickets_read on public.tickets;
create policy tickets_read on public.tickets
  for select to authenticated
  using (
    customer_id = auth.uid()
    or assignee_id = auth.uid()
    or (public.is_staff() and assignee_id is null)
  );

drop policy if exists tickets_customer_insert on public.tickets;
create policy tickets_customer_insert on public.tickets
  for insert to authenticated
  with check (
    customer_id = auth.uid()
    and (assignee_id is null or public.is_programmer(assignee_id))
  );

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets
  for update to authenticated
  using (
    customer_id = auth.uid()
    or assignee_id = auth.uid()
    or (public.is_staff() and assignee_id is null)
  )
  with check (
    (
      customer_id = auth.uid()
      or assignee_id = auth.uid()
      or (public.is_staff() and assignee_id is null)
    )
    and (assignee_id is null or public.is_programmer(assignee_id))
  );

drop policy if exists tickets_admin_delete on public.tickets;
create policy tickets_admin_delete on public.tickets
  for delete to authenticated
  using (public.is_admin() and public.can_access_ticket(id));

-- Message edits inherit the same gate. There is no edit UI today, but the
-- old policy let any programmer update any message by id, including tickets
-- assigned to someone else.
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using (
    public.can_access_ticket(ticket_id)
    and (author_id = auth.uid() or public.is_staff())
  )
  with check (
    public.can_access_ticket(ticket_id)
    and (author_id = auth.uid() or public.is_staff())
  );

-- ---------------------------------------------------------------------------
-- 5. Sidebar badge: count only the open tickets this programmer can work on.
-- ---------------------------------------------------------------------------
create or replace function public.get_nav_counts()
returns table (customer_active bigint, staff_open bigint)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    (select count(*)
       from public.tickets
      where customer_id = auth.uid()
        and status in ('Open', 'In Progress')) as customer_active,
    case
      when public.is_staff() then
        (select count(*)
           from public.tickets
          where status = 'Open'
            and (assignee_id is null or assignee_id = auth.uid()))
      else 0
    end as staff_open;
$$;

comment on function public.get_nav_counts() is
  'Badge counts in one round-trip. Staff queue is assignment-aware and zero for non-staff.';

revoke all on function public.get_nav_counts() from public;
grant execute on function public.get_nav_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Knowledge Base is removed. Dropping the view also removes the endpoint
--    that bypassed per-customer privacy before 0009.
-- ---------------------------------------------------------------------------
drop view if exists public.ticket_knowledge;

-- Verify (run separately):
--   select * from public.list_programmers();
--   -- As a programmer JWT, count visible tickets:
--   select count(*) from public.tickets;
--   -- As any authenticated user, this must now fail with "relation does not exist":
--   select count(*) from public.ticket_knowledge;


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
