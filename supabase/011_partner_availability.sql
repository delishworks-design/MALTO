-- 011_partner_availability.sql
-- Lets a partner publish when they work, and lets a client book a real slot.
--
-- The important part is the last section. Application code that checks "is this
-- slot free" before inserting is not a guarantee: two people booking the same
-- partner at 9:00 both read an empty slot and both write. The exclusion
-- constraint below makes the second insert fail in the database instead, so the
-- clash is impossible no matter how many clients race.
--
-- Time is stored as timestamptz built from the booking's date plus the exact
-- start time the client chose, in Asia/Manila. The window label ("Morning")
-- stays on bookings.time for the admin calendar; starts_at/ends_at carry the
-- precision the constraint needs.
--
-- Run: supabase db query --linked -f supabase/011_partner_availability.sql

begin;

-- ---------------------------------------------------------------------------
-- When a partner works
--
-- Weekly recurring rules, not individual slots: partners should not have to
-- open a calendar for the next three months to say they are free on Tuesdays.
-- ---------------------------------------------------------------------------
create table if not exists public.partner_availability_rules (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.team_members(id) on delete cascade,
  weekday    int  not null check (weekday between 0 and 6),  -- 0 = Sunday
  start_time time  not null,
  end_time   time  not null,
  constraint partner_availability_rules_order check (end_time > start_time)
);

create index if not exists partner_availability_rules_partner_idx
  on public.partner_availability_rules (partner_id, weekday);

-- Specific days off, which override the weekly rule for that date.
create table if not exists public.partner_time_off (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.team_members(id) on delete cascade,
  on_date    date not null,
  reason     text not null default '',
  unique (partner_id, on_date)
);

create index if not exists partner_time_off_date_idx on public.partner_time_off (partner_id, on_date);

-- Both are written by the portal API using the service role, after resolving the
-- caller from the session.
alter table public.partner_availability_rules enable row level security;
alter table public.partner_time_off enable row level security;
revoke all on public.partner_availability_rules, public.partner_time_off from anon, authenticated;
grant select, insert, update, delete on public.partner_availability_rules to service_role;
grant select, insert, update, delete on public.partner_time_off to service_role;

-- ---------------------------------------------------------------------------
-- Precise time on a booking
--
-- partner_id is nullable: the client may leave the choice to MALTO, and a
-- booking can exist before anybody is assigned.
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists partner_id uuid references public.team_members(id) on delete set null,
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists duration_hours numeric(4,1);

-- starts_at implies ends_at. Both are optional because a one-time booking can
-- stay date-only, as it is today.
alter table public.bookings
  drop constraint if exists bookings_time_pair_check;
alter table public.bookings
  add constraint bookings_time_pair_check
    check ((starts_at is null and ends_at is null)
        or (starts_at is not null and ends_at is not null and ends_at > starts_at));

-- ---------------------------------------------------------------------------
-- The double-booking guard
--
-- btree_gist is what lets a plain uuid equality and a time range live in the
-- same exclusion constraint. Without it Postgres cannot use gist for the uuid
-- column and the whole approach is unavailable.
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist;

do $$
begin
  -- One visit in progress or finished, cancelled work is excluded from the
  -- comparison entirely.
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_no_partner_overlap'
  ) then
    alter table public.bookings
      add constraint bookings_no_partner_overlap
      exclude using gist (
        partner_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      )
      where (partner_id is not null and starts_at is not null and status <> 'Cancelled');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Available slots
--
-- Given a partner and a date, returns the start times they could take, honouring
-- their weekly rules, their days off, and anything already booked. Exposed so the
-- booking form never computes availability itself.
-- ---------------------------------------------------------------------------
create or replace function public.partner_slots(
  p_partner_id uuid,
  p_on_date date,
  p_window text default null,      -- 'Morning' | 'Afternoon' | 'Evening' | null
  p_minutes int default 30
)
returns table (starts_at timestamptz, label text)
language sql
stable
security definer
set search_path = public
as $$
  -- How long a visit is assumed to be when testing a start time for clashes.
  -- Matches the duration the app stores on a booking.
  with planning as (select interval '3 hours' as span),
  bounds(window_label, from_hour, to_hour) as (
    values ('Morning', 6, 12), ('Afternoon', 12, 17), ('Evening', 17, 21)
  ),
  wanted as (
    select * from bounds
     where p_window is null or nullif(trim(p_window), '') is null or window_label = p_window
  ),
  spans as (
    -- Where the partner's own hours overlap the requested window. A partner who
    -- has not published hours yet falls back to the whole window, so they are
    -- still bookable instead of silently invisible.
    select
      (p_on_date + greatest(coalesce(r.start_time, make_time(w.from_hour, 0, 0)),
                            make_time(w.from_hour, 0, 0))) at time zone 'Asia/Manila' as span_start,
      (p_on_date + least(coalesce(r.end_time, make_time(w.to_hour, 0, 0)),
                         make_time(w.to_hour, 0, 0))) at time zone 'Asia/Manila' as span_end
      from wanted w
      left join public.partner_availability_rules r
        on r.partner_id = p_partner_id
       and r.weekday = extract(dow from p_on_date)::int
  ),
  valid as (
    select span_start, span_end from spans where span_end > span_start
  ),
  grid as (
    -- Every p_minutes increment that leaves room for a full visit before the
    -- span closes, so a 17:00 start is never offered for a shift ending 18:00.
    select gs as start_at
      from valid v
      cross join planning pl
      cross join lateral generate_series(
        v.span_start,
        greatest(v.span_start, v.span_end - pl.span),
        make_interval(mins => greatest(p_minutes, 15))
      ) as gs
  )
  select
    g.start_at as starts_at,
    to_char(g.start_at at time zone 'Asia/Manila', 'HH12:MI AM') as label
  from grid g
  where g.start_at > now()
    and not exists (
      select 1 from public.partner_time_off t
       where t.partner_id = p_partner_id and t.on_date = p_on_date
    )
    and not exists (
      select 1
        from public.bookings b
        cross join planning pl
       where b.partner_id = p_partner_id
         and b.status <> 'Cancelled'
         and b.starts_at is not null
         and tstzrange(b.starts_at, b.ends_at, '[)')
             && tstzrange(g.start_at, g.start_at + pl.span, '[)')
    )
  order by g.start_at;
$$;

revoke all on function public.partner_slots(uuid, date, text, int) from public, anon;
grant execute on function public.partner_slots(uuid, date, text, int) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Default every existing approved partner to a full working week
--
-- Without this, everyone who registered before this migration would show no
-- available slots and be unbookable. Weekdays 08:00-18:00, Saturday half day.
-- ---------------------------------------------------------------------------
insert into public.partner_availability_rules (partner_id, weekday, start_time, end_time)
select m.id, w.weekday,
       case when w.weekday = 6 then time '09:00' else time '08:00' end,
       time '18:00'
  from public.team_members m
  cross join (values (1),(2),(3),(4),(5),(6)) as w(weekday)
 where m.portal_status = 'approved'
   and not m.is_sample
   and not exists (
     select 1 from public.partner_availability_rules r where r.partner_id = m.id
   )
on conflict do nothing;

commit;

-- Verification
do $$
declare
  v_tables int; v_fn int; v_con int; v_rules int;
begin
  select count(*) into v_tables from pg_tables
   where schemaname='public'
     and tablename in ('partner_availability_rules','partner_time_off');
  select count(*) into v_fn from pg_proc
   where proname='partner_slots' and pronamespace='public'::regnamespace;
  select count(*) into v_con from pg_constraint
   where conname='bookings_no_partner_overlap';
  select count(*) into v_rules from public.partner_availability_rules;

  raise notice 'V-P availability tables=% (2), partner_slots=% (1), overlap constraint=% (1), default rules seeded=% ',
    v_tables, v_fn, v_con, v_rules;
  if v_tables <> 2 or v_fn <> 1 or v_con <> 1 then
    raise exception 'V-P FAILED';
  end if;
end $$;
