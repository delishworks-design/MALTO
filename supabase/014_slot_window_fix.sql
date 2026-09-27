-- ---------------------------------------------------------------------------
-- partner_slots, corrected after being tested against a real partner
--
-- 1. "Morning" could only ever offer one start time.
--
--    The grid was clamped to span_end minus the 3 hour planning span, on the
--    theory that a visit has to fit inside the window. A cleaner working
--    09:00 to 18:00, asked for the Morning window (06:00 to 12:00), got the
--    intersection 09:00 to 12:00, and the clamp cut the last possible start to
--    09:00. The customer was shown a single time and no way to understand why.
--
--    The window is a preference bucket for when the visit begins, not a hard
--    box the whole visit has to fit inside, so starts are now generated to the
--    end of the intersection. The 3 hour span stays where it belongs: deciding
--    whether a start would collide with a booking that is already in.
--
-- 2. A partner was shown as working on days they had not set up.
--
--    The weekly rules were joined with a left join and a missing rule fell back
--    to the entire window. The intent was to keep a partner who had never
--    published hours at all visible, but the join cannot tell "no rules yet"
--    apart from "no rule for this weekday", so a partner whose only rules were
--    Monday to Friday was offered every Sunday, and every Saturday, forever.
--    The fallback now applies only when the partner genuinely has no rules.
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
  rules_today as (
    select r.weekday, r.start_time, r.end_time
      from public.partner_availability_rules r
     where r.partner_id = p_partner_id
       and r.weekday = extract(dow from p_on_date)::int
  ),
  has_any_rule as (
    select 1 from public.partner_availability_rules r
     where r.partner_id = p_partner_id
     limit 1
  ),
  spans as (
    -- The partner's own hours intersected with the requested window. A rule
    -- that starts before the window opens is pulled forward to the window, and
    -- one that ends after it closes is cut back, so a 09:00 to 18:00 rule asked
    -- for the Afternoon window yields 12:00 to 17:00.
    --
    -- The left join is kept so a partner with no rules at all still gets the
    -- whole window instead of disappearing from the marketplace. But the
    -- where clause is what stops it bleeding into days they never scheduled:
    -- a missing rule only means "available all day" when the partner has no
    -- rules whatsoever, not when they have rules for other weekdays.
    select
      (p_on_date + greatest(coalesce(r.start_time, make_time(w.from_hour, 0, 0)),
                            make_time(w.from_hour, 0, 0))) at time zone 'Asia/Manila' as span_start,
      (p_on_date + least(coalesce(r.end_time, make_time(w.to_hour, 0, 0)),
                         make_time(w.to_hour, 0, 0))) at time zone 'Asia/Manila' as span_end
      from wanted w
      left join rules_today r on true
     where r.weekday is not null
        or not exists (select 1 from has_any_rule)
  ),
  valid as (
    select span_start, span_end from spans where span_end > span_start
  ),
  grid as (
    -- Every p_minutes start inside the span, up to but not including the moment
    -- the window closes, so the last offer is a real start time rather than the
    -- hour the preference ends.
    select gs as start_at
      from valid v
      cross join lateral generate_series(
        v.span_start,
        v.span_end,
        make_interval(mins => greatest(p_minutes, 15))
      ) as gs
    where gs < v.span_end
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
         and b.starts_at < g.start_at + pl.span
         and b.starts_at + pl.span > g.start_at
    )
  order by g.start_at;
$$;

comment on function public.partner_slots(uuid, date, text, int) is
  'Free start times for a bookable partner on a date, honouring their weekly hours, days off and existing bookings. Returns nothing for an inactive, unapproved, sample or paused partner, and nothing for a weekday the partner has not scheduled.';
