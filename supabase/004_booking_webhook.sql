-- 004_booking_webhook.sql
-- Fires the "new booking" admin alert: AFTER INSERT on bookings -> HTTP POST
-- to /api/webhooks/booking-created via pg_net (this is what a Supabase
-- "Database Webhook" does under the hood, done as code so it is versioned).
--
-- The shared secret lives in public.webhook_config (RLS on, NO policies =
-- service_role/postgres only) and is inserted OUT OF BAND — never commit it.
-- Every failure is swallowed so a broken webhook can never block a booking.
--
-- Run: supabase db query --linked -f supabase/004_booking_webhook.sql

begin;

create extension if not exists pg_net;

-- Secret/config store: service role only (same pattern as email_secret).
create table if not exists public.webhook_config (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

alter table public.webhook_config enable row level security;

drop policy if exists webhook_config_no_anon on public.webhook_config;
drop policy if exists webhook_config_no_authenticated on public.webhook_config;
-- Deliberately NO policies: nobody but postgres/service_role can read or write.
-- Explicitly strip the login roles so the intent is obvious in pg_policies.
revoke all on public.webhook_config from anon, authenticated;
grant  select, insert, update, delete on public.webhook_config to service_role;

create or replace function public.booking_created_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url    text := 'https://malto-cleaning-services.vercel.app/api/webhooks/booking-created';
  v_secret text;
begin
  -- Only meaningful inside a trigger; blocks direct calls from anon.
  if TG_OP is null or TG_TABLE_NAME is distinct from 'bookings' then
    return null;
  end if;

  select value into v_secret from public.webhook_config where key = 'booking_webhook_secret';
  if v_secret is null or v_secret = '' then
    raise notice 'booking_created_webhook: secret not configured, alert skipped';
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object(
                 'type',   'INSERT',
                 'table',  'bookings',
                 'record', to_jsonb(new)
               ),
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type',    'application/json',
                 'Authorization',   'Bearer ' || v_secret
               ),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise notice 'booking_created_webhook failed: %', sqlerrm;
  return new;
end;
$$;

-- EXECUTE stays available to the login roles: a trigger is fired by whoever
-- performed the INSERT (anon on the public booking form), and the TG_OP guard
-- above already rejects direct calls, so there is nothing to abuse here.
grant execute on function public.booking_created_webhook() to anon, authenticated, service_role, postgres;

drop trigger if exists trg_booking_created_webhook on public.bookings;
create trigger trg_booking_created_webhook
after insert on public.bookings
for each row execute function public.booking_created_webhook();

commit;

-- Verification
do $$
declare v_fn int; v_trg int; v_pol int;
begin
  select count(*) into v_fn from pg_proc
    where proname = 'booking_created_webhook' and pronamespace = 'public'::regnamespace;
  select count(*) into v_trg from pg_trigger
    where tgname = 'trg_booking_created_webhook' and not tgisinternal;
  select count(*) into v_pol from pg_policies
    where schemaname = 'public' and tablename = 'webhook_config';
  raise notice 'V-H function=% (expect 1), trigger=% (expect 1), webhook_config policies=% (expect 0)',
    v_fn, v_trg, v_pol;
  if v_fn <> 1 or v_trg <> 1 or v_pol <> 0 then
    raise exception 'V-H FAILED';
  end if;
end $$;
