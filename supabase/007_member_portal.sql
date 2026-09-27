-- 007_member_portal.sql
-- Team member portal: real accounts, job assignments, and the authorization
-- split that makes them safe.
--
-- Until now every private table was `TO authenticated USING (true)` and the
-- admin guard only asked "is anybody signed in?". That was harmless with a
-- single admin account, but the moment a team member signs in they inherit
-- full read/write on bookings (customer details, prices, admin notes),
-- pricing_rules, email_settings and the whole /admin app.
--
-- So the split is enforced in the database, not in the UI:
--
--   is_admin()      -> true only for rows in `admins`
--   team_members    -> a member may read and update ONLY their own row
--   assignments     -> a member may read and respond to ONLY their own work
--   my_assignments()-> SECURITY DEFINER, returns their own jobs, admin_notes
--                      deliberately excluded, and no bookings policy is granted
--                      to members at all
--
-- Column-level changes are blocked with BEFORE triggers rather than GRANTs on
-- a subset of columns, because a column grant is per role: restricting
-- `authenticated` would also stop admins from editing their own dashboard.
--
-- Run: supabase db query --linked -f supabase/007_member_portal.sql

begin;

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Deliberately no policies: postgres and service_role only. is_admin() reads
-- this as SECURITY DEFINER, which is why members can be told whether they are
-- an admin without ever being able to read the list.
revoke all on public.admins from anon, authenticated;
grant select, insert, update, delete on public.admins to service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Seed the existing admin account. Keyed off auth.users by email so the id is
-- correct on any environment, and re-running is harmless.
insert into public.admins (user_id, email)
select u.id, u.email
  from auth.users u
 where u.email = 'admin@malto.com'
on conflict (user_id) do update set email = excluded.email;

-- ---------------------------------------------------------------------------
-- Re-point every admin policy at is_admin()
-- ---------------------------------------------------------------------------
-- bookings: public form can still insert, but nothing is readable or editable
-- by a plain signed-in user.
drop policy if exists bookings_select_admin on public.bookings;
create policy bookings_select_admin on public.bookings
  for select to authenticated using (public.is_admin());

drop policy if exists bookings_update_admin on public.bookings;
create policy bookings_update_admin on public.bookings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Internal, never public.
drop policy if exists pricing_rules_admin_all on public.pricing_rules;
create policy pricing_rules_admin_all on public.pricing_rules
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists price_cards_admin_all on public.price_cards;
create policy price_cards_admin_all on public.price_cards
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists service_rates_admin_all on public.service_rates;
create policy service_rates_admin_all on public.service_rates
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists email_settings_admin_all on public.email_settings;
create policy email_settings_admin_all on public.email_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists email_secret_admin_all on public.email_secret;
create policy email_secret_admin_all on public.email_secret
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists email_outbox_admin_read on public.email_outbox;
create policy email_outbox_admin_read on public.email_outbox
  for select to authenticated using (public.is_admin());

-- site_settings drives the public website, so the anon read policy has to stay.
-- Only the authenticated/admin half is re-pointed at is_admin(): dropping the
-- public read here would silently drop the whole site back to its hardcoded
-- fallbacks, because the public pages fetch this table with the anon key.
drop policy if exists site_settings_public_read on public.site_settings;
create policy site_settings_public_read on public.site_settings
  for select to anon using (is_public = true);

drop policy if exists site_settings_admin_all on public.site_settings;
create policy site_settings_admin_all on public.site_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Team members: identity link, approval state, availability
-- ---------------------------------------------------------------------------
alter table public.team_members
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists portal_status text not null default 'invited'
    check (portal_status in ('invited','pending','approved','blocked')),
  add column if not exists available boolean not null default true,
  add column if not exists unavailable_note text not null default '';

create index if not exists team_members_user_id_idx
  on public.team_members (user_id) where user_id is not null;

-- A unique index, not a UNIQUE constraint, so admins can still save a member
-- without an email while one already exists rather than hitting a hard error.
create unique index if not exists team_members_user_id_key
  on public.team_members (user_id) where user_id is not null;

drop policy if exists team_members_admin_all on public.team_members;
create policy team_members_admin_all on public.team_members
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Members see themselves, and only themselves. Permissive policies are OR'd,
-- so an admin still matches the first one and a member matches this one.
drop policy if exists team_members_own_read on public.team_members;
drop policy if exists team_members_own_update on public.team_members;
create policy team_members_own_read on public.team_members
  for select to authenticated
  using (user_id = auth.uid());

create policy team_members_own_update on public.team_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------------
create table if not exists public.assignments (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings(id) on delete cascade,
  member_id    uuid not null references public.team_members(id) on delete cascade,
  status       text not null default 'pending'
    check (status in ('pending','accepted','declined','on_the_way','done','cancelled')),
  note         text not null default '',
  member_note  text not null default '',
  assigned_by  uuid references auth.users(id) on delete set null,
  assigned_at  timestamptz not null default now(),
  responded_at timestamptz,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (booking_id, member_id)
);

create index if not exists assignments_member_idx  on public.assignments (member_id);
create index if not exists assignments_booking_idx on public.assignments (booking_id);

alter table public.assignments enable row level security;

drop policy if exists assignments_admin_all on public.assignments;
create policy assignments_admin_all on public.assignments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists assignments_own_read on public.assignments;
drop policy if exists assignments_own_update on public.assignments;
create policy assignments_own_read on public.assignments
  for select to authenticated
  using (exists (
    select 1 from public.team_members m
     where m.id = assignments.member_id and m.user_id = auth.uid()
  ));

create policy assignments_own_update on public.assignments
  for update to authenticated
  using (exists (
    select 1 from public.team_members m
     where m.id = assignments.member_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.team_members m
     where m.id = assignments.member_id and m.user_id = auth.uid()
  ));

revoke all on public.assignments from anon, authenticated;
grant select, insert, update, delete on public.assignments to service_role;
grant select, update on public.assignments to authenticated;

-- ---------------------------------------------------------------------------
-- Protect the columns a member must never change
--
-- RLS already limits WHICH rows a member can touch. These stop them from
-- re-pointing a row they own at a different booking, re-linking their account,
-- or promoting themselves to approved.
-- ---------------------------------------------------------------------------
create or replace function public.protect_team_member_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role bypasses RLS, but a service key carries no user id, so
  -- is_admin() alone would block admin maintenance scripts.
  if public.is_admin() or coalesce(auth.role(),'') = 'service_role' then
    return new;
  end if;
  if new.user_id is distinct from old.user_id
     or new.portal_status is distinct from old.portal_status then
    raise exception 'Only an admin can change a member''s account link or approval status.';
  end if;
  return new;
end;
$$;

create or replace function public.protect_assignment_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() or coalesce(auth.role(),'') = 'service_role' then
    return new;
  end if;
  if new.booking_id is distinct from old.booking_id
     or new.member_id is distinct from old.member_id
     or new.assigned_by is distinct from old.assigned_by
     or new.assigned_at is distinct from old.assigned_at
     or new.note is distinct from old.note then
    raise exception 'You can only respond to your own assignment, not change who it belongs to.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_team_member_link on public.team_members;
create trigger trg_protect_team_member_link
  before update on public.team_members
  for each row execute function public.protect_team_member_link();

drop trigger if exists trg_protect_assignment_columns on public.assignments;
create trigger trg_protect_assignment_columns
  before update on public.assignments
  for each row execute function public.protect_assignment_columns();

-- Used by the guard above and by the portal shell, so the approval check lives
-- in one place.
create or replace function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members m
     where m.user_id = auth.uid()
       and m.portal_status = 'approved'
       and m.active = true
  );
$$;

revoke all on function public.is_approved_member() from public, anon;
grant execute on function public.is_approved_member() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What a member is allowed to see of a booking
--
-- Members are given NO select policy on bookings at all. This function is the
-- only path, and it decides the columns: admin_notes is absent, price is
-- present. If a policy were ever misconfigured, the exposure is still bounded
-- by this list rather than by the whole row.
-- ---------------------------------------------------------------------------
-- Dropped first because the OUT-parameter row type is part of the function's
-- identity: altering the column list fails with "cannot change return type".
drop function if exists public.my_assignments();

create function public.my_assignments()
returns table (
  assignment_id uuid,
  status        text,
  note          text,
  member_note   text,
  assigned_at   timestamptz,
  responded_at  timestamptz,
  done_at       timestamptz,
  booking_id    uuid,
  booking_ref   text,
  names         text,
  phone         text,
  email         text,
  services      text,
  date          date,
  "time"       text,
  adress        text,
  city          text,
  province      text,
  landmark      text,
  access        text,
  property      text,
  sqm           text,
  bedrooms      integer,
  bathrooms     integer,
  areas         text,
  condition     text,
  scope_notes   text,
  materials     text,
  price         numeric,
  photo_path    text,
  booking_status text,
  booking_created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.status, a.note, a.member_note, a.assigned_at,
         a.responded_at, a.done_at,
         b.id, b.booking_ref, b.names, b.phone, b.email, b.services, b.date, b."time",
         b.adress, b.city, b.province, b.landmark, b.access, b.property, b.sqm,
         b.bedrooms, b.bathrooms, b.areas, b.condition, b.scope_notes, b.materials,
         b.price, b.photo_path, b.status, b.created_at
    from public.assignments a
    join public.team_members m on m.id = a.member_id
    join public.bookings b on b.id = a.booking_id
   where m.user_id = auth.uid()
     and public.is_approved_member()
   order by b.date asc nulls last, a.assigned_at asc;
$$;

revoke all on function public.my_assignments() from public, anon;
grant execute on function public.my_assignments() to authenticated, service_role;

commit;

-- Verification
do $$
declare
  v_admins   int;
  v_seed     int;
  v_anon_ins int;
  v_fn       int;
  v_tbl      int;
  v_cols     int;
  v_leak     int;
begin
  select count(*) into v_admins   from pg_tables where schemaname='public' and tablename='admins';
  select count(*) into v_tbl      from pg_tables where schemaname='public' and tablename='assignments';
  select count(*) into v_cols     from information_schema.columns
   where table_schema='public' and table_name='team_members'
     and column_name in ('user_id','portal_status','available','unavailable_note');
  select count(*) into v_fn from pg_proc
   where proname in ('is_admin','is_approved_member','my_assignments',
                     'protect_team_member_link','protect_assignment_columns')
     and pronamespace='public'::regnamespace;
  select count(*) into v_seed from public.admins;
  -- The public booking form must keep working: anon INSERT is still there.
  select count(*) into v_anon_ins from pg_policies
   where schemaname='public' and tablename='bookings' and policyname='bookings_insert_anon';
  -- my_assignments() must not be able to surface admin_notes.
  select count(*) into v_leak
    from pg_proc
   where proname = 'my_assignments'
     and pronamespace = 'public'::regnamespace
     and prosrc ilike '%admin_notes%';

  raise notice 'V-K admins table=% (1), assignments table=% (1), team_members new cols=% (4), functions=% (5), seeded admins=% (1), anon booking insert policy=% (1)',
    v_admins, v_tbl, v_cols, v_fn, v_seed, v_anon_ins;
  raise notice 'V-K my_assignments() references admin_notes (expect 0): %', v_leak;

  if v_admins <> 1 or v_tbl <> 1 or v_cols <> 4 or v_fn <> 5
     or v_seed < 1 or v_anon_ins <> 1 or v_leak <> 0 then
    raise exception 'V-K FAILED';
  end if;
end $$;
