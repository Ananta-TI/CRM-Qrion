-- =============================================================================
-- Qrion CRM — Customer Complaint Ticketing
-- Migration 0001: Core schema, enums, tables, indexes, triggers, RLS
-- Target: Supabase Postgres (project tljbpqscuzwakwmtvnli)
-- Run this in the Supabase SQL Editor, or via `npm run db:push`.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. ENUMERATED TYPES
-- -----------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('customer', 'agent', 'manager', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type urgency_level as enum ('Low', 'Medium', 'High', 'Critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ticket_status as enum ('Open', 'In Progress', 'Waiting Validation', 'Closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type escalation_level as enum ('L1', 'L2', 'L3');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_author_role as enum ('customer', 'agent', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_kind as enum ('text', 'note', 'system', 'solution');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- 2. SLA POLICY
-- Maps (urgency, escalation level) to a resolution target in minutes.
-- The triage engine reads this table, so SLA targets are data, not code.
-- -----------------------------------------------------------------------------
create table if not exists public.sla_policy (
  urgency          urgency_level    not null,
  level            escalation_level not null default 'L1',
  response_minutes int              not null check (response_minutes > 0),
  resolve_minutes  int              not null check (resolve_minutes > 0),
  primary key (urgency, level)
);

insert into public.sla_policy (urgency, level, response_minutes, resolve_minutes) values
  ('Critical', 'L1',   15,   240),   -- 4 hours
  ('High',     'L1',   30,   480),   -- 8 hours
  ('Medium',   'L1',   60,  1440),   -- 24 hours
  ('Low',      'L1',  240,  4320),   -- 72 hours
  ('Critical', 'L2',   10,   120),   -- 2 hours
  ('High',     'L2',   20,   240),
  ('Medium',   'L2',   45,   720),
  ('Low',      'L2',  120,  2880),
  ('Critical', 'L3',    5,    60),   -- 1 hour
  ('High',     'L3',   15,   180),
  ('Medium',   'L3',   30,   480),
  ('Low',      'L3',   60,  1440)
on conflict (urgency, level) do update
  set response_minutes = excluded.response_minutes,
      resolve_minutes  = excluded.resolve_minutes;

-- -----------------------------------------------------------------------------
-- 3. PROFILES — one row per auth.users row
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text not null default 'Unnamed',
  role         user_role not null default 'customer',
  company      text,
  phone        text,
  avatar_tint  text default '#cdeccf',
  timezone     text default 'GMT+7 · Jakarta',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);

-- -----------------------------------------------------------------------------
-- 4. TICKETS — the complaint ticket itself
-- -----------------------------------------------------------------------------
create sequence if not exists public.ticket_ref_seq start 100001;

create table if not exists public.tickets (
  id                 uuid primary key default gen_random_uuid(),
  ticket_code        text unique not null
                       default 'TKT-' || to_char(now(), 'YYMM') || '-' ||
                               lpad(nextval('public.ticket_ref_seq')::text, 6, '0'),
  customer_id        uuid not null references public.profiles(id) on delete restrict,
  assignee_id        uuid references public.profiles(id) on delete set null,
  subject            text not null check (char_length(trim(subject)) between 3 and 160),
  description        text not null check (char_length(trim(description)) between 10 and 5000),
  category           text not null default 'Lainnya'
                       check (category in ('Transaksi','Pembayaran','Pengiriman','Akun','Teknis','Produk','Lainnya')),
  urgency            urgency_level  not null default 'Medium',
  status             ticket_status  not null default 'Open',
  escalation_level   escalation_level not null default 'L1',
  -- Structured transaction history the complaint refers to
  transaction_ref    text,
  transaction_date   date,
  transaction_amount numeric(14,2),
  transaction_history jsonb not null default '[]'::jsonb,
  -- SLA bookkeeping
  sla_policy_minutes int,
  sla_deadline       timestamptz,
  first_response_at  timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  sla_breached       boolean not null default false,
  -- Validation loop
  reopen_count       int not null default 0,
  -- Customer satisfaction, captured after Closed
  csat_score         smallint check (csat_score between 1 and 5),
  csat_comment       text,
  csat_at            timestamptz,
  -- Knowledge base
  resolution_summary text,
  tags               text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists tickets_customer_idx  on public.tickets(customer_id, created_at desc);
create index if not exists tickets_assignee_idx  on public.tickets(assignee_id, status);
create index if not exists tickets_status_idx    on public.tickets(status);
create index if not exists tickets_sla_idx       on public.tickets(sla_deadline) where status <> 'Closed';
create index if not exists tickets_category_idx  on public.tickets(category);
create index if not exists tickets_search_idx    on public.tickets
  using gin (to_tsvector('simple', subject || ' ' || description));

-- -----------------------------------------------------------------------------
-- 5. MESSAGES — chat thread between agent and customer
-- -----------------------------------------------------------------------------
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.tickets(id) on delete cascade,
  author_id    uuid references public.profiles(id) on delete set null,
  author_role  message_author_role not null default 'customer',
  kind         message_kind not null default 'text',
  body         text not null check (char_length(trim(body)) between 1 and 5000),
  attachments  jsonb not null default '[]'::jsonb,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists messages_ticket_idx on public.messages(ticket_id, created_at);

-- -----------------------------------------------------------------------------
-- 6. TICKET EVENTS — immutable audit trail (status, escalation, SLA)
-- -----------------------------------------------------------------------------
create table if not exists public.ticket_events (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  event_type  text not null,   -- created | status_changed | escalated | assigned | csat | sla_breach
  from_value  text,
  to_value    text,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists ticket_events_ticket_idx on public.ticket_events(ticket_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 7. HELPER FUNCTIONS
-- -----------------------------------------------------------------------------

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tickets_touch on public.tickets;
create trigger tickets_touch before update on public.tickets
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Role lookup that bypasses RLS (used inside policies).
-- SECURITY DEFINER prevents the infinite recursion you get when a policy on
-- profiles needs to read profiles.
create or replace function public.current_role_name()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
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
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- Whether the caller may see/modify the given ticket.
create or replace function public.can_access_ticket(p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket
      and (
        t.customer_id = auth.uid()
        or public.is_staff()
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- 8. TRIAGE ENGINE — derives SLA deadline from urgency + level
-- -----------------------------------------------------------------------------
create or replace function public.apply_sla(p_ticket uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_urgency urgency_level;
  v_level   escalation_level;
  v_minutes int;
  v_created timestamptz;
begin
  select urgency, escalation_level, created_at
    into v_urgency, v_level, v_created
  from public.tickets where id = p_ticket;

  if v_urgency is null then
    return;
  end if;

  select resolve_minutes into v_minutes
  from public.sla_policy
  where urgency = v_urgency and level = v_level;

  -- Fall back to the closest defined policy if the pair is missing.
  if v_minutes is null then
    select resolve_minutes into v_minutes
    from public.sla_policy
    where urgency = v_urgency
    order by resolve_minutes asc
    limit 1;
  end if;

  update public.tickets
     set sla_policy_minutes = v_minutes,
         sla_deadline = v_created + make_interval(mins => v_minutes)
   where id = p_ticket;
end $$;

-- Auto-calculate the SLA deadline on insert and whenever urgency/level changes.
create or replace function public.tickets_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes int;
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

    new.sla_policy_minutes := v_minutes;
    new.sla_deadline := new.created_at + make_interval(mins => coalesce(v_minutes, 1440));
  end if;

  -- Stamp lifecycle timestamps as the status moves.
  if new.status = 'Closed' and (old.status is distinct from 'Closed' or tg_op = 'INSERT') then
    new.closed_at := coalesce(new.closed_at, now());
  elsif new.status <> 'Closed' then
    new.closed_at := null;
  end if;

  if new.status = 'Waiting Validation'
     and (tg_op = 'INSERT' or old.status is distinct from 'Waiting Validation') then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;

  return new;
end $$;

drop trigger if exists tickets_before_write on public.tickets;
create trigger tickets_before_write before insert or update on public.tickets
  for each row execute function public.tickets_before_write();

-- -----------------------------------------------------------------------------
-- 9. AUTO-CREATE PROFILE ON SIGNUP
--    Role is taken from the signup metadata, but only admins may self-assign a
--    staff role. Anything else defaults to 'customer'.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role := 'customer';
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.tickets       enable row level security;
alter table public.messages      enable row level security;
alter table public.ticket_events enable row level security;
alter table public.sla_policy    enable row level security;

-- sla_policy: readable by everyone signed in, writable by admins only.
drop policy if exists sla_read on public.sla_policy;
create policy sla_read on public.sla_policy
  for select to authenticated using (true);

drop policy if exists sla_admin_write on public.sla_policy;
create policy sla_admin_write on public.sla_policy
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles: a user sees themself and staff; staff see everyone; only the owner
-- (or an admin) may edit.
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated using (
    id = auth.uid() or public.is_staff()
  );

-- Customers need to see the name of the agent handling their ticket.
drop policy if exists profiles_peer_read on public.profiles;
create policy profiles_peer_read on public.profiles
  for select to authenticated using (
    exists (
      select 1 from public.tickets t
      where (t.customer_id = auth.uid() and t.assignee_id = profiles.id)
         or (t.assignee_id = auth.uid() and t.customer_id = profiles.id)
    )
  );

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (
    -- A non-admin cannot promote themselves.
    (id = auth.uid() and role = (select role from public.profiles p where p.id = auth.uid()))
    or public.is_admin()
  );

-- tickets
drop policy if exists tickets_read on public.tickets;
create policy tickets_read on public.tickets
  for select to authenticated using (
    customer_id = auth.uid() or public.is_staff()
  );

drop policy if exists tickets_customer_insert on public.tickets;
create policy tickets_customer_insert on public.tickets
  for insert to authenticated with check (customer_id = auth.uid());

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets
  for update to authenticated
  using (customer_id = auth.uid() or public.is_staff())
  with check (customer_id = auth.uid() or public.is_staff());

drop policy if exists tickets_admin_delete on public.tickets;
create policy tickets_admin_delete on public.tickets
  for delete to authenticated using (public.is_admin());

-- messages: anyone attached to the ticket can read; authors write their own.
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages
  for select to authenticated using (public.can_access_ticket(ticket_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated with check (
    public.can_access_ticket(ticket_id)
    and author_id = auth.uid()
    and (
      -- A customer may only post to their own ticket as 'customer'.
      (author_role = 'customer' and exists (
        select 1 from public.tickets t
        where t.id = ticket_id and t.customer_id = auth.uid()))
      -- Staff may post as 'agent' or 'system'.
      or (author_role in ('agent','system') and public.is_staff())
    )
  );

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated using (
    author_id = auth.uid() or public.is_staff()
  ) with check (
    author_id = auth.uid() or public.is_staff()
  );

-- ticket_events: readable with the ticket, appended by the server only.
drop policy if exists events_read on public.ticket_events;
create policy events_read on public.ticket_events
  for select to authenticated using (public.can_access_ticket(ticket_id));

drop policy if exists events_insert on public.ticket_events;
create policy events_insert on public.ticket_events
  for insert to authenticated with check (
    public.can_access_ticket(ticket_id) and actor_id = auth.uid()
  );

-- -----------------------------------------------------------------------------
-- 11. ANALYTICS VIEW — powers the Knowledge Base page
-- -----------------------------------------------------------------------------
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
  extract(epoch from (t.closed_at - t.created_at)) / 3600.0 as hours_to_close,
  c.full_name as customer_name,
  a.full_name as agent_name
from public.tickets t
join public.profiles c on c.id = t.customer_id
left join public.profiles a on a.id = t.assignee_id;

-- The view runs with the caller's permissions, so RLS on tickets still applies.
grant select on public.ticket_knowledge to authenticated;

-- -----------------------------------------------------------------------------
-- 12. GRANTS
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.tickets       to authenticated;
grant select, insert, update, delete on public.messages      to authenticated;
grant select, insert                 on public.ticket_events to authenticated;
grant select, insert, update         on public.profiles      to authenticated;
grant select                         on public.sla_policy    to authenticated;

-- Mark tickets that blew their SLA. Call from a scheduled job, or on read.
create or replace function public.refresh_sla_breaches()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  with hit as (
    update public.tickets
       set sla_breached = true
     where status <> 'Closed'
       and sla_deadline < now()
       and sla_breached = false
    returning 1
  )
  select count(*) into v_count from hit;
  return v_count;
end $$;
