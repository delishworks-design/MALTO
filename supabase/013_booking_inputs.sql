-- ---------------------------------------------------------------------------
-- partner_slots: only answer for a partner who can actually be booked
--
-- The function took any partner id and returned their free times, including for
-- a partner who was taken off the marketplace, never approved, or one of the
-- sample profiles. Nothing about a slot is secret, but the endpoint should not
-- confirm that a blocked partner has a Tuesday free at 2pm, and the booking
-- form must never be able to render a sample as bookable.
--
-- city_code on bookings records which PSGC entry the customer actually picked,
-- so a booking can be counted against a city and against a partner's declared
-- coverage. The free-text city and province stay as they were: they are what
-- the confirmation email and the printed job sheet read.
-- ---------------------------------------------------------------------------

alter table public.bookings add column if not exists city_code text;

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
  -- Refuse the whole call for anyone not currently bookable, so the guard
  -- applies before a single slot is produced rather than filtered afterwards.
  bookable as (
    select 1 from public.team_members m
     where m.id = p_partner_id
       and m.active
       and m.portal_status = 'approved'
       and m.is_accepting_jobs
       and not coalesce(m.is_sample, false)
  ),
  wanted as (
    select * from bounds
     where (p_window is null or nullif(trim(p_window), '') is null or window_label = p_window)
       and exists (select 1 from bookable)
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
    )
  order by g.start_at;
$$;

comment on function public.partner_slots(uuid, date, text, int) is
  'Free start times for a bookable partner on a date, honouring weekly rules, days off and existing bookings. Returns nothing for an inactive, unapproved, sample or paused partner.';
