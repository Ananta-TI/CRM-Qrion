-- ============================================================================
-- 0009_security_fixes.sql
--
-- Two authorization leaks found during the audit:
--
--   1. `ticket_knowledge` is owned by `postgres`, so the view read `tickets`
--      with the owner's privileges and bypassed RLS. Any signed-in customer
--      could query /rest/v1/ticket_knowledge and receive every customer's
--      tickets, including descriptions and agent names. Recreate the view with
--      `security_invoker = true` so the caller's RLS applies.
--
--      If a cross-customer knowledge base is a product requirement later, add
--      a separate curated view/table that exposes only explicitly published
--      fields — do not turn this view back into a SECURITY DEFINER view.
--
--   2. `get_nav_counts()` is SECURITY DEFINER and returned the global
--      `staff_open` count to every authenticated caller. Customers do not need
--      the internal queue size; gate it behind `is_staff()`.
--
-- Run after 0008. Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Make the knowledge view obey the caller's row-level security.
-- ---------------------------------------------------------------------------
alter view public.ticket_knowledge set (security_invoker = true);

comment on view public.ticket_knowledge is
  'Ticket analytics/archive. security_invoker=true: tickets and profiles RLS apply to the caller.';

-- The view was recreated in 0008, so make the grant explicit even when this
-- migration is run on a database where 0008 already did it.
grant select on public.ticket_knowledge to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Do not leak the global staff queue to customers.
-- ---------------------------------------------------------------------------
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

-- Verify (run separately):
--   -- As a customer JWT, this must return only their own tickets:
--   select count(*) from public.ticket_knowledge;
--   -- As a customer, staff_open must be 0:
--   select * from public.get_nav_counts();
