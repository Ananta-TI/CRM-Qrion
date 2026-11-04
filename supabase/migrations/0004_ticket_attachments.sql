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
