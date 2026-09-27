-- 006_email_provider_response.sql
-- Records what the SMTP server actually replied to each send.
--
-- The outbox already knew a message had been accepted, but not what the
-- provider said. That gap is why a typo in reply_to went unnoticed: the row
-- said "sent" while the alert was going to a domain that does not exist. Gmail
-- accepts a message and only bounces it afterwards, so the reply text is the
-- best evidence available at send time and is worth keeping for diagnosis.
--
-- Additive and idempotent: safe to run more than once.
--
-- Run: supabase db query --linked -f supabase/006_email_provider_response.sql

begin;

alter table public.email_outbox add column if not exists provider_response text;

comment on column public.email_outbox.provider_response is
  'Raw reply from the SMTP server, stored on success. Gmail accepts then bounces later, so this is not proof of delivery.';

commit;

-- Verification
do $$
declare v_col int;
begin
  select count(*) into v_col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'email_outbox'
     and column_name = 'provider_response';

  raise notice 'V-J email_outbox.provider_response columns=% (expect 1)', v_col;
  if v_col <> 1 then
    raise exception 'V-J FAILED';
  end if;
end $$;
