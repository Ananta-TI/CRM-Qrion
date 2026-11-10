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
