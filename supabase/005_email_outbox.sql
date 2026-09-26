-- 005_email_outbox.sql
-- Makes booking email delivery reliable.
--
-- Until now the trigger called the app once and the result was thrown away:
-- a failure logged a notice, the HTTP response was ignored, and the email was
-- gone with nobody able to tell. There was also no way to stop a booking being
-- marked Confirmed when its quote email had not actually been sent.
--
-- This records the *intent* to send in a table, so delivery can be retried
-- until it works and a human can always see what is still outstanding.
--
--   bookings INSERT -> email_outbox rows (pending)
--                   -> pg_net POST /api/email/drain
--   pg_cron every 5 min -> same endpoint, picks up anything left behind
--   complete_email_outbox() -> marks sent, and only then confirms a quote
--
-- The shared secret stays in public.webhook_config (inserted out of band, never
-- committed) and is reused here so no new environment variable is needed.
--
-- Run: supabase db query --linked -f supabase/005_email_outbox.sql

begin;

-- Retry is driven by pg_cron, so the scheduler has to be present.
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Outbox
-- ---------------------------------------------------------------------------
create table if not exists public.email_outbox (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid references public.bookings(id) on delete cascade,
  kind           text not null check (kind in ('admin_alert','booking_received','quote')),
  to_email       text not null,
  payload        jsonb not null default '{}'::jsonb,
  -- Only used by kind='quote': the price to write back once the mail is out.
  price          numeric,
  status         text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts       int  not null default 0,
  last_error     text,
  last_attempt_at timestamptz,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);

create index if not exists email_outbox_due_idx
  on public.email_outbox (status, last_attempt_at);

alter table public.email_outbox enable row level security;

-- The dashboard shows the outstanding rows so the admin can see what failed
-- and retry by hand. Everything that writes stays service_role/postgres only,
-- so nobody can forge a row or mark one as sent.
drop policy if exists email_outbox_admin_read on public.email_outbox;
create policy email_outbox_admin_read on public.email_outbox
  for select to authenticated using (true);

-- Strip the default privileges Supabase grants on new tables, so the table
-- grants below are the whole story: authenticated reads, service_role writes.
revoke all on public.email_outbox from anon, authenticated;
grant select on public.email_outbox to authenticated;
grant select, insert, update, delete on public.email_outbox to service_role;

-- ---------------------------------------------------------------------------
-- Claim: hand out due rows to exactly one drain, nobody else.
-- skip locked is what stops the trigger and the cron job from double-sending
-- the same row when they overlap.
-- ---------------------------------------------------------------------------
create or replace function public.claim_email_outbox(p_limit int default 10)
returns setof public.email_outbox
language sql
security definer
set search_path = public, extensions
as $$
  with due as (
    select id
      from public.email_outbox
     where status = 'pending'
        -- A failed row waits longer the more it has been tried, so a broken
        -- SMTP host is not hammered 5 times inside one minute.
        or (status = 'failed'
            and attempts < 5
            and coalesce(last_attempt_at, created_at)
                <= now() - (attempts * interval '5 minutes'))
     order by coalesce(last_attempt_at, created_at)
     limit greatest(p_limit, 1)
     for update skip locked
  )
  update public.email_outbox o
     set status = 'sending',
         attempts = o.attempts + 1,
         last_attempt_at = now()
    from due
   where o.id = due.id
  returning o.*;
$$;

revoke all on function public.claim_email_outbox(int) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(int) to service_role;

-- ---------------------------------------------------------------------------
-- Complete: mark the row, and for a quote write the price back.
--
-- The booking update happens in the same statement as the status change so a
-- booking can never end up Confirmed without a delivered quote, and cannot be
-- delivered-but-unrecorded.
-- ---------------------------------------------------------------------------
create or replace function public.complete_email_outbox(
  p_id uuid,
  p_ok boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.email_outbox;
begin
  if p_ok then
    update public.email_outbox
       set status = 'sent', sent_at = now(), last_error = null
     where id = p_id
    returning * into v_row;

    if v_row is null then return; end if;

    if v_row.kind = 'quote' and v_row.price is not null and v_row.booking_id is not null then
      update public.bookings
         set price = v_row.price,
             -- A cancelled booking stays cancelled; a quote never revives it.
             status = case when status = 'Cancelled' then status else 'Confirmed' end
       where id = v_row.booking_id;
    end if;
  else
    -- Leave it claimable again so the next drain can pick it up.
    update public.email_outbox
       set status = 'failed', last_error = left(coalesce(p_error, 'unknown error'), 500)
     where id = p_id;
  end if;
end;
$$;

revoke all on function public.complete_email_outbox(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.complete_email_outbox(uuid, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- Enqueue on booking
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_booking_emails()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url    text := 'https://malto-cleaning-services.vercel.app/api/email/drain';
  v_secret text;
begin
  if TG_OP is null or TG_TABLE_NAME is distinct from 'bookings' then
    return null;
  end if;

  select value into v_secret from public.webhook_config where key = 'booking_webhook_secret';
  if v_secret is null or v_secret = '' then
    raise notice 'enqueue_booking_emails: secret not configured, emails skipped';
    return new;
  end if;

  -- The admin alert leaves to cfg.reply_to / from_email / smtp_user, which the
  -- app resolves, so it is stored with a marker and resolved at send time.
  insert into public.email_outbox (booking_id, kind, to_email, payload)
  values (new.id, 'admin_alert', '', to_jsonb(new));

  -- No address, nothing to acknowledge.
  if new.email is not null and btrim(new.email) <> '' then
    insert into public.email_outbox (booking_id, kind, to_email, payload)
    values (new.id, 'booking_received', btrim(new.email), to_jsonb(new));
  end if;

  -- Nested block on purpose: an `exception` clause rolls its whole block back,
  -- so the http_post needs its own subtransaction. If it shared one with the
  -- inserts above, a failure here would discard the queued emails too and the
  -- cron job would have nothing left to retry.
  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('booking_id', new.id),
      params  := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      -- Two SMTP handshakes in one request; 5s was not enough headroom.
      timeout_milliseconds := 15000
    );
  exception when others then
    raise notice 'enqueue_booking_emails: immediate drain call failed (%), queued rows will wait for pg_cron', sqlerrm;
  end;

  return new;
exception when others then
  raise notice 'enqueue_booking_emails failed: %', sqlerrm;
  return new;
end;
$$;

grant execute on function public.enqueue_booking_emails() to anon, authenticated, service_role, postgres;

-- Replaces the pg_net trigger from 004. 004 is left untouched as history; the
-- old function is dropped here because the new trigger supersedes it.
drop trigger if exists trg_booking_created_webhook on public.bookings;
drop function if exists public.booking_created_webhook();

drop trigger if exists trg_booking_enqueued on public.bookings;
create trigger trg_booking_enqueued
  after insert on public.bookings
  for each row execute function public.enqueue_booking_emails();

-- ---------------------------------------------------------------------------
-- Retry job
--
-- Anything the trigger missed, or that failed, is retried here. Once every
-- 5 minutes keeps it to ~288 requests a day and lines up with the backoff.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'email-outbox-drain') then
    perform cron.unschedule('email-outbox-drain');
  end if;

  perform cron.schedule(
    'email-outbox-drain',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url     := 'https://malto-cleaning-services.vercel.app/api/email/drain',
        body    := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || coalesce(
            (select value from public.webhook_config where key = 'booking_webhook_secret'), '')
        ),
        timeout_milliseconds := 15000
      );
    $cron$
  );
end $$;

commit;

-- Verification
do $$
declare v_tbl int; v_fn int; v_trg int; v_job int; v_old_fn int;
begin
  select count(*) into v_tbl from pg_tables
    where schemaname = 'public' and tablename = 'email_outbox';
  select count(*) into v_fn from pg_proc
    where proname in ('claim_email_outbox','complete_email_outbox','enqueue_booking_emails')
      and pronamespace = 'public'::regnamespace;
  select count(*) into v_trg from pg_trigger
    where tgname = 'trg_booking_enqueued' and not tgisinternal;
  select count(*) into v_old_fn from pg_proc
    where proname = 'booking_created_webhook' and pronamespace = 'public'::regnamespace;
  select count(*) into v_job from cron.job where jobname = 'email-outbox-drain';

  raise notice 'V-I outbox table=% (expect 1), functions=% (expect 3), enqueue trigger=% (expect 1), cron job=% (expect 1), old 004 function=% (expect 0)',
    v_tbl, v_fn, v_trg, v_job, v_old_fn;

  if v_tbl <> 1 or v_fn <> 3 or v_trg <> 1 or v_job <> 1 or v_old_fn <> 0 then
    raise exception 'V-I FAILED';
  end if;
end $$;
