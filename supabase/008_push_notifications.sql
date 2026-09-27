-- 008_push_notifications.sql
-- Web Push subscriptions for team members, using the browser's own Push API
-- with VAPID. No Firebase, no third-party account, no per-message cost.
--
-- Chosen over SMS because it is free and instant, and because a part-time
-- member who does not know a job exists will not accept it.
--
-- Members get no direct access to this table at all: the browser posts its
-- subscription to an API route, and the route derives member_id from the
-- session. A member therefore cannot write a row onto somebody else's record,
-- which column-level rules could not have prevented cleanly.
--
-- The VAPID private key is stored encrypted with the same AES-256-GCM helper
-- used for the SMTP password, so a database dump cannot be used to push
-- messages to your members' phones.
--
-- Run: supabase db query --linked -f supabase/008_push_notifications.sql

begin;

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.team_members(id) on delete cascade,
  -- The endpoint is unique per browser push service, so re-subscribing the
  -- same phone updates in place instead of piling up dead rows.
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text not null default '',
  created_at    timestamptz not null default now(),
  last_success_at timestamptz
);

create index if not exists push_subscriptions_member_idx
  on public.push_subscriptions (member_id);

alter table public.push_subscriptions enable row level security;

-- Intentionally no policies for authenticated: every read and write goes
-- through an API route using the service role.
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- VAPID keypair, single row. Generated once and inserted out of band, like the
-- webhook secret, so the private key is never committed.
create table if not exists public.push_config (
  id                   int primary key default 1 check (id = 1),
  public_key           text not null,
  private_key_encrypted text not null,
  updated_at           timestamptz not null default now()
);

alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
grant select, insert, update, delete on public.push_config to service_role;

commit;

-- Verification
do $$
declare v_sub int; v_cfg int; v_policies int;
begin
  select count(*) into v_sub from pg_tables
    where schemaname='public' and tablename='push_subscriptions';
  select count(*) into v_cfg from pg_tables
    where schemaname='public' and tablename='push_config';
  -- Members must have no policy at all on either table.
  select count(*) into v_policies from pg_policies
    where schemaname='public'
      and tablename in ('push_subscriptions','push_config')
      and 'authenticated' = any(roles);

  raise notice 'V-L push_subscriptions=% (1), push_config=% (1), member policies=% (expect 0)',
    v_sub, v_cfg, v_policies;
  if v_sub <> 1 or v_cfg <> 1 or v_policies <> 0 then
    raise exception 'V-L FAILED';
  end if;
end $$;
