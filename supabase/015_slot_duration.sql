-- ---------------------------------------------------------------------------
-- partner_slots: bound a start by the partner's real shift, not the window
--
-- Testing this against a live partner turned up a constraint nobody had
-- connected: bookings_time_pair_check refuses a row where starts_at is set
-- but ends_at is not, and bookings_no_partner_overlap builds its exclusion
-- range from the two together. So a booking with a chosen time has to carry a
-- real start and a real end, which means the slot list and the booking have to
-- agree on how long a service takes.
--
-- The previous version intersected the partner's hours with the requested
-- window and treated the window as a box the whole visit had to fit inside.
-- That is wrong twice over. A Morning window is six hours and a Home Cleaning
-- is five, so almost every start spilled out of it and the customer was shown a
-- single option. And the only bound that actually matters is the partner's own
-- shift, not the label on the dropdown.
--
-- So now:
--   - the span is the partner's hours for that weekday, unclipped;
--   - the window only decides which of those starts are shown, by start hour;
--   - a start is offered when the visit can finish before the partner stops
--     working, using the duration the caller passes rather than a fixed guess.
--
-- p_duration_minutes defaults to 180 to keep the old three hour planning block
-- for any caller that has not been updated, so this is not a breaking change.
-- ---------------------------------------------------------------------------

create or replace function public.partner_slots(
  p_partner_id uuid,
  p_on_date date,
  p_window text default null,      -- 'Morning' | 'Afternoon' | 'Evening' | null
  p_minutes int default 30,
  p_duration_minutes int default 180
)
returns table (starts_at timestamptz, label text)
language sql
stable
security definer
set search_path = public
as $$
  with planning as (select make_interval(mins => greatest(p_duration_minutes, 15)) as span),
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
  -- The partner's real hours for this weekday. A missing rule only means
  -- "available all day" when the partner has no rules at all, never when they
  -- have rules for other weekdays, so Monday to Friday never turns into
  -- Saturday and Sunday.
  spans as (
    select
      (p_on_date + coalesce(r.start_time, make_time(6, 0, 0))) at time zone 'Asia/Manila' as span_start,
      (p_on_date + coalesce(r.end_time, make_time(21, 0, 0))) at time zone 'Asia/Manila' as span_end
      from rules_today r
     where r.weekday is not null
     union all
     select
       (p_on_date + make_time(6, 0, 0)) at time zone 'Asia/Manila',
       (p_on_date + make_time(21, 0, 0)) at time zone 'Asia/Manila'
     where not exists (select 1 from rules_today)
       and not exists (select 1 from has_any_rule)
       and exists (select 1 from bookable)
  ),
  grid as (
    -- Every start inside the shift that still leaves room for the whole visit
    -- before the partner finishes. The window is applied below, by start hour,
    -- so it narrows the list without pretending the visit has to fit in it.
    select gs as start_at
      from spans v
      cross join planning pl
      cross join lateral generate_series(
        v.span_start,
        v.span_end,
        make_interval(mins => greatest(p_minutes, 15))
      ) as gs
     where gs + pl.span <= v.span_end
  )
  select
    g.start_at as starts_at,
    to_char(g.start_at at time zone 'Asia/Manila', 'HH12:MI AM') as label
  from grid g
  where exists (select 1 from bookable)
    -- The window decides whether a start is shown, by the hour it begins.
    -- Listed as hours rather than a range so an unrecognised label falls
    -- through to an empty list: showing every slot for a typo would be worse
    -- than showing none.
    and (
      p_window is null
      or nullif(trim(p_window), '') is null
      or extract(hour from g.start_at at time zone 'Asia/Manila') = any (
        case p_window
          when 'Morning'   then array[6,7,8,9,10,11]::int[]
          when 'Afternoon' then array[12,13,14,15,16]::int[]
          when 'Evening'   then array[17,18,19,20]::int[]
          else '{}'::int[]
        end
      )
    )
    and g.start_at > now()
    and not exists (
      select 1 from public.partner_time_off t
       where t.partner_id = p_partner_id and t.on_date = p_on_date
    )
    and not exists (
      select 1
        from public.bookings bk
        cross join planning pl
       where bk.partner_id = p_partner_id
         and bk.status <> 'Cancelled'
         and bk.starts_at is not null
         and bk.ends_at is not null
         and bk.starts_at < g.start_at + pl.span
         and bk.starts_at + pl.span > g.start_at
    )
  order by g.start_at;
$$;

comment on function public.partner_slots(uuid, date, text, int, int) is
  'Free start times for a bookable partner on a date, honouring their weekly hours, days off and existing bookings. A start is offered when a visit of p_duration_minutes can finish before the partner stops working, and the window only narrows by start hour. Returns nothing for an inactive, unapproved, sample or paused partner, and nothing for a weekday the partner has not scheduled.';
