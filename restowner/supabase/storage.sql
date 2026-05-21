-- ============================================================
--  restowner — event image uploads (Supabase Storage)
--
--  A public bucket for owner-uploaded event photos. The diner app
--  displays the images, so read is public; only signed-in owners
--  (all authenticated users are vetted via vautcher_owners) upload.
--  Re-runnable (idempotent).
-- ============================================================

insert into storage.buckets (id, name, public)
values ('vautcher-event-images', 'vautcher-event-images', true)
on conflict (id) do nothing;

-- Anyone may view the images.
drop policy if exists "vautcher event imgs read" on storage.objects;
create policy "vautcher event imgs read"
  on storage.objects for select
  using (bucket_id = 'vautcher-event-images');

-- Signed-in owners may upload.
drop policy if exists "vautcher event imgs insert" on storage.objects;
create policy "vautcher event imgs insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'vautcher-event-images');

-- Signed-in owners may delete.
drop policy if exists "vautcher event imgs delete" on storage.objects;
create policy "vautcher event imgs delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'vautcher-event-images');
