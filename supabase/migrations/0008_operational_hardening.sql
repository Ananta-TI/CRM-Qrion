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
