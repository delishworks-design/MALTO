-- 003_team_photos.sql
-- Private bucket for admin-uploaded team member photos.
-- Team photos are admin-only content: read/insert/delete are granted to
-- authenticated users only (staff role), never to anon.
-- Run: supabase db query --linked -f supabase/003_team_photos.sql

begin;

insert into storage.buckets (id, name, public)
values ('team-photos', 'team-photos', false)
on conflict (id) do update set public = false;

drop policy if exists team_photo_insert_staff on storage.objects;
create policy team_photo_insert_staff on storage.objects
  for insert to authenticated
  with check (bucket_id = 'team-photos');

drop policy if exists team_photo_select_staff on storage.objects;
create policy team_photo_select_staff on storage.objects
  for select to authenticated
  using (bucket_id = 'team-photos');

drop policy if exists team_photo_delete_staff on storage.objects;
create policy team_photo_delete_staff on storage.objects
  for delete to authenticated
  using (bucket_id = 'team-photos');

commit;

-- Verification
do $$
declare v_total int; v_policies int; v_bucket_public boolean;
begin
  select count(*) into v_total from storage.objects where bucket_id = 'team-photos';
  select count(*) into v_policies from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'team_photo_%';
  select public into v_bucket_public from storage.buckets where id = 'team-photos';
  raise notice 'V-G team-photos objects=% (expect 0), policies=% (expect 3), public=% (expect false)',
    v_total, v_policies, v_bucket_public;
  if v_policies <> 3 or v_bucket_public then
    raise exception 'V-G FAILED';
  end if;
end $$;
