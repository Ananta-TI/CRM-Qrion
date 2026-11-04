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
