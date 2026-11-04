-- ============================================================================
-- 0007_notifications.sql
--
-- Two small, idempotent changes that the notification bell and the chat
-- thread depend on:
--
--   1. A global `created_at` index on `ticket_events`, because the bell reads
--      the newest events across every ticket the caller can access (the
--      existing index is keyed by ticket first, so it cannot serve that).
--   2. `messages_insert` now also accepts system messages written by staff
--      with no author. The old policy required `author_id = auth.uid()`, which
--      made rows like "Tiket dieskalasi..." impossible to insert from the
--      server action. System messages stay staff-only; customers cannot forge
--      them.
--
-- Run once in the Supabase SQL Editor (or as part of APPLY-ALL.sql).
-- ============================================================================

create index if not exists ticket_events_created_idx
  on public.ticket_events(created_at desc);

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated with check (
    public.can_access_ticket(ticket_id)
    and (
      -- A normal post: the author is the caller and the role matches theirs.
      (
        author_id = auth.uid()
        and (
          (author_role = 'customer' and exists (
            select 1 from public.tickets t
            where t.id = ticket_id and t.customer_id = auth.uid()))
          or (author_role in ('agent', 'system') and public.is_staff())
        )
      )
      -- Staff-authored system notice with no profile attached.
      or (
        author_id is null
        and author_role = 'system'
        and public.is_staff()
      )
    )
  );

-- Verify (run separately, after the above):
--   select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'ticket_events';
--   select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'messages';
