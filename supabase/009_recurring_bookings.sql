-- 009_recurring_bookings.sql
-- Lets a client book on a repeating schedule, applies a discount for it, and
-- generates the follow-up visits without anyone retyping the request.
--
-- Design notes that matter:
--
-- * The plan carries its own JSONB snapshot of the booking rather than pointing
--   at the first booking row. If the anchor visit is later cancelled or
--   deleted, the plan keeps working instead of vanishing with it.
--
-- * recurring_occurrences has (plan_id, occurrence_date) as its primary key.
--   Generation inserts with ON CONFLICT DO NOTHING, so a cron job that fires
--   while one is already running, or a second run in the same window, can never
--   produce two bookings for the same visit. This is the whole reason the table
--   exists rather than a counter on the plan.
--
-- * discount_pct is snapshotted onto both the plan and each generated booking.
--   Editing the discount later must not silently reprice work already agreed.
--
-- Run: supabase db query --linked -f supabase/009_recurring_bookings.sql

begin;

-- ---------------------------------------------------------------------------
-- Discounts per frequency, editable in Settings
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_discounts (
  frequency    text primary key
    check (frequency in ('once','weekly','biweekly','monthly')),
  label        text not null,
  client_label text not null default '',
  discount_pct numeric(5,2) not null default 0 check (discount_pct >= 0 and discount_pct <= 100),
  sort_order   int not null default 0,
  updated_at   timestamptz not null default now()
);

insert into public.recurring_discounts (frequency, label, client_label, discount_pct, sort_order)
values
  ('once',     'One-time',     '',                      0,  1),
  ('weekly',   'Weekly',       'Every week',          10,  2),
  ('biweekly', 'Twice a week', 'Twice a week',        15,  3),
  ('monthly',  'Monthly',      'Once a month',         5,  4)
on conflict (frequency) do nothing;

-- Readable by the public website (it has to show the discount) and by admins.
alter table public.recurring_discounts enable row level security;

drop policy if exists recurring_discounts_public_read on public.recurring_discounts;
create policy recurring_discounts_public_read on public.recurring_discounts
  for select to anon, authenticated using (true);

drop policy if exists recurring_discounts_admin_all on public.recurring_discounts;
create policy recurring_discounts_admin_all on public.recurring_discounts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.recurring_discounts to anon, authenticated;
grant select, insert, update, delete on public.recurring_discounts to service_role;

-- ---------------------------------------------------------------------------
-- Bookings carry the choice the client made
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists frequency text not null default 'once'
    check (frequency in ('once','weekly','biweekly','monthly')),
  add column if not exists discount_pct numeric(5,2) not null default 0;

-- The booking form inserts frequency; the policy already pins status to
-- 'New Request' for anon, so the check constraint does the rest.

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_plans (
  id            uuid primary key default gen_random_uuid(),
  -- Set from the booking the client actually made. on delete set null so
  -- removing the anchor visit does not cascade the whole plan away.
  anchor_booking_id uuid references public.bookings(id) on delete set null,
  frequency     text not null check (frequency in ('weekly','biweekly','monthly')),
  discount_pct  numeric(5,2) not null default 0,
  next_date     date not null,
  -- Self-contained copy of everything needed to build a follow-up booking.
  template      jsonb not null,
  status        text not null default 'active'
    check (status in ('active','paused','cancelled','finished')),
  -- null means "keep going until cancelled".
  occurrences_remaining int check (occurrences_remaining is null or occurrences_remaining > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists recurring_plans_due_idx
  on public.recurring_plans (next_date) where status = 'active';

alter table public.recurring_plans enable row level security;
revoke all on public.recurring_plans from anon, authenticated;
grant select, insert, update, delete on public.recurring_plans to service_role;

-- ---------------------------------------------------------------------------
-- One row per generated visit. The primary key is the duplicate guard.
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_occurrences (
  plan_id        uuid not null references public.recurring_plans(id) on delete cascade,
  occurrence_date date not null,
  booking_id     uuid references public.bookings(id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (plan_id, occurrence_date)
);

alter table public.recurring_occurrences enable row level security;
revoke all on public.recurring_occurrences from anon, authenticated;
grant select, insert, update, delete on public.recurring_occurrences to service_role;

-- ---------------------------------------------------------------------------
-- The rate is the server's decision, never the client's
--
-- The public booking form is allowed to insert into bookings, and its RLS
-- policy only pins status. So anything the client sends for discount_pct would
-- be taken at face value, and a hand-rolled request could ask for a 100%
-- discount. The client therefore sends only the frequency it picked, and this
-- trigger looks the percentage up from recurring_discounts.
-- ---------------------------------------------------------------------------
create or replace function public.set_booking_discount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_pct numeric;
begin
  if TG_OP = 'INSERT' then
    select coalesce(discount_pct, 0) into v_pct
      from public.recurring_discounts
     where frequency = coalesce(new.frequency, 'once');
    new.discount_pct := coalesce(v_pct, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_booking_discount on public.bookings;
create trigger trg_set_booking_discount
  before insert on public.bookings
  for each row execute function public.set_booking_discount();

-- ---------------------------------------------------------------------------
-- Open a plan when a client books on a schedule
-- ---------------------------------------------------------------------------
create or replace function public.open_recurring_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template jsonb;
  v_next     date;
begin
  if TG_OP is null or TG_TABLE_NAME is distinct from 'bookings' then
    return null;
  end if;
  if new.frequency is null or new.frequency = 'once' then
    return new;
  end if;
  if new.date is null then
    raise notice 'open_recurring_plan: booking % has no date, no plan opened', new.id;
    return new;
  end if;
  -- A visit produced by generate_recurring_occurrences() must not open a plan
  -- of its own, or every generated visit would spawn another plan and the
  -- schedule would grow without bound. REC- is reserved for those rows.
  if new.booking_ref is not null and new.booking_ref like 'REC-%' then
    return new;
  end if;

  -- Every field the follow-up visit needs, captured now.
  v_template := jsonb_build_object(
    'names', new.names, 'email', new.email, 'phone', new.phone,
    'services', new.services, 'time', new.time,
    'adress', new.adress, 'city', new.city, 'province', new.province,
    'landmark', new.landmark, 'access', new.access,
    'property', new.property, 'sqm', new.sqm,
    'bedrooms', new.bedrooms, 'bathrooms', new.bathrooms,
    'areas', new.areas, 'condition', new.condition,
    'scope_notes', new.scope_notes, 'materials', new.materials,
    'notes', new.notes, 'photo_path', new.photo_path,
    'frequency', new.frequency, 'discount_pct', new.discount_pct
  );

  v_next := case new.frequency
    when 'weekly'   then (new.date + interval '7 days')::date
    when 'biweekly' then (new.date + interval '14 days')::date
    when 'monthly'  then (new.date + interval '1 month')::date
    else new.date
  end;

  insert into public.recurring_plans
    (anchor_booking_id, frequency, discount_pct, next_date, template, status)
  values
    (new.id, new.frequency, new.discount_pct, v_next, v_template, 'active');

  return new;
exception when others then
  -- A booking must never fail because its plan could not be created; the admin
  -- can still set the schedule up by hand.
  raise notice 'open_recurring_plan failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_open_recurring_plan on public.bookings;
create trigger trg_open_recurring_plan
  after insert on public.bookings
  for each row execute function public.open_recurring_plan();

-- ---------------------------------------------------------------------------
-- Generate due occurrences
--
-- Called by pg_cron. Walks forward only while the next visit falls inside the
-- lead window, so a plan that has not been touched for a while still catches up
-- one visit at a time instead of inventing a backlog.
-- ---------------------------------------------------------------------------
create or replace function public.generate_recurring_occurrences(
  p_lead_days int default 14,
  p_max_plans int default 50
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    record;
  v_n       int := 0;
  v_claimed int;
  v_bid     uuid;
  v_ref     text;
  v_horizon date := current_date + p_lead_days;
begin
  for v_plan in
    select * from public.recurring_plans
     where status = 'active'
       and next_date <= v_horizon
     order by next_date
     limit greatest(p_max_plans, 1)
     for update skip locked
  loop
    -- Catch up one visit per iteration, so a long gap cannot create a burst.
    exit when v_plan.next_date > v_horizon;

    v_ref := 'REC-' || to_char(v_plan.next_date, 'YYYYMMDD') || '-' || substr(replace(v_plan.id::text,'-',''), 1, 6);

    -- Claim the slot first. The primary key on (plan_id, occurrence_date) is
    -- what makes this safe: if another run already took this visit, the insert
    -- conflicts and we claim nothing, so the booking below is never reached.
    -- Doing it the other way round would insert a duplicate booking and only
    -- then discover the visit already existed.
    insert into public.recurring_occurrences (plan_id, occurrence_date, booking_id)
    values (v_plan.id, v_plan.next_date, null)
    on conflict (plan_id, occurrence_date) do nothing;

    get diagnostics v_claimed = row_count;

    if v_claimed = 0 then
      -- Already generated on an earlier run; just move the plan forward.
      update public.recurring_plans
         set next_date = case frequency
                           when 'weekly'   then (next_date + interval '7 days')::date
                           when 'biweekly' then (next_date + interval '14 days')::date
                           when 'monthly'  then (next_date + interval '1 month')::date
                           else next_date + 1
                         end,
             updated_at = now()
       where id = v_plan.id;
      continue;
    end if;

    insert into public.bookings (
      names, email, phone, services, date, time,
      adress, city, province, landmark, access,
      property, sqm, bedrooms, bathrooms, areas, condition,
      scope_notes, materials, notes, photo_path,
      frequency, discount_pct, status, booking_ref
    )
    select
      (v_plan.template->>'names'),
      (v_plan.template->>'email'),
      (v_plan.template->>'phone'),
      (v_plan.template->>'services'),
      v_plan.next_date,
      (v_plan.template->>'time'),
      (v_plan.template->>'adress'),
      (v_plan.template->>'city'),
      (v_plan.template->>'province'),
      (v_plan.template->>'landmark'),
      (v_plan.template->>'access'),
      (v_plan.template->>'property'),
      (v_plan.template->>'sqm'),
      nullif(v_plan.template->>'bedrooms','')::int,
      nullif(v_plan.template->>'bathrooms','')::int,
      (v_plan.template->>'areas'),
      (v_plan.template->>'condition'),
      (v_plan.template->>'scope_notes'),
      (v_plan.template->>'materials'),
      (v_plan.template->>'notes'),
      (v_plan.template->>'photo_path'),
      v_plan.frequency,
      v_plan.discount_pct,
      'New Request',
      v_ref
    returning id into v_bid;

    update public.recurring_occurrences
       set booking_id = v_bid
     where plan_id = v_plan.id and occurrence_date = v_plan.next_date;

    v_n := v_n + 1;

    -- Advance. Stopping at a NULL remaining count means "keep going".
    update public.recurring_plans
       set next_date = case frequency
                         when 'weekly'   then (next_date + interval '7 days')::date
                         when 'biweekly' then (next_date + interval '14 days')::date
                         when 'monthly'  then (next_date + interval '1 month')::date
                         else next_date + 1
                       end,
           occurrences_remaining = case
                         when occurrences_remaining is null then null
                         else occurrences_remaining - 1
                       end,
           status = case
                         when occurrences_remaining is not null and occurrences_remaining - 1 <= 0
                           then 'finished' else status
                       end,
           updated_at = now()
     where id = v_plan.id;
  end loop;

  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron: every 5 minutes, same job that drains the email outbox
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'recurring-generate') then
    perform cron.unschedule('recurring-generate');
  end if;

  perform cron.schedule(
    'recurring-generate',
    '*/5 * * * *',
    $cron$ select public.generate_recurring_occurrences(14, 50); $cron$
  );
end $$;

commit;

-- Verification
do $$
declare
  v_tables int;
  v_fn     int;
  v_rows   int;
  v_job    int;
  v_book_cols int;
begin
  select count(*) into v_tables from pg_tables
   where schemaname='public'
     and tablename in ('recurring_discounts','recurring_plans','recurring_occurrences');
  select count(*) into v_fn from pg_proc
   where proname in ('open_recurring_plan','generate_recurring_occurrences','set_booking_discount')
     and pronamespace='public'::regnamespace;
  select count(*) into v_rows from public.recurring_discounts;
  select count(*) into v_job from cron.job where jobname='recurring-generate';
  select count(*) into v_book_cols from information_schema.columns
   where table_schema='public' and table_name='bookings'
     and column_name in ('frequency','discount_pct');

  raise notice 'V-M recurring tables=% (3), functions=% (3), seeded discounts=% (4), bookings cols=% (2), cron job=% (1)',
    v_tables, v_fn, v_rows, v_book_cols, v_job;
  if v_tables <> 3 or v_fn <> 3 or v_rows <> 4 or v_book_cols <> 2 or v_job <> 1 then
    raise exception 'V-M FAILED';
  end if;
end $$;
