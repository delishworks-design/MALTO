-- 018_partner_self_service.sql
-- Everything the redesigned partner app needs that the database does not
-- allow yet. Grouped by what it unblocks.
--
-- Idempotent: safe to re-run.
--
--   1. push_devices, for FCM tokens from the Android app (separate from the
--      existing VAPID push_subscriptions, which are browser endpoints)
--   2. self-service RLS on partner_areas and partner_services, so a partner can
--      finally edit their own coverage and services
--   3. REPLICA IDENTITY FULL on bookings, so the admin's realtime refresh
--      actually receives UPDATE payloads
--   4. city search, for the profile editor's coverage picker

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. FCM devices
-- ---------------------------------------------------------------------------
-- One row per app install. A member can have several: a phone, a second phone,
-- and a tablet they signed into and then forgot about. The unique key is the
-- token, because FCM rotates a token on reinstall and the old row would
-- otherwise linger and collect failed sends forever.
CREATE TABLE IF NOT EXISTS public.push_devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  platform    text NOT NULL DEFAULT 'android',
  app_version text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  seen_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_devices_user_idx ON public.push_devices(user_id);

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

-- A member reads and deletes only their own devices, and inserts only their
-- own. The INSERT policy is what stops a signed-in member from attaching a
-- token to somebody else's account, which would make them receive that
-- person's job alerts.
DROP POLICY IF EXISTS push_devices_own_all ON public.push_devices;
CREATE POLICY push_devices_own_all ON public.push_devices
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.push_devices FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_devices TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Self-service coverage and services
-- ---------------------------------------------------------------------------
-- partner_areas and partner_services were created write-through-admin only, and
-- both carry a GRANT to authenticated with no policy that matches a non-admin.
-- A GRANT without a matching policy is just a comment: every query returns zero
-- rows and every write returns 403. The admin team page hit exactly this and
-- the fix was to add the policies, not more grants.
--
-- Delete is required, not optional. Editing a set means removing what is no
-- longer wanted before inserting what is, and there is no other way to express
-- "remove this one city" against a join table.
--
-- Self-scoped by the same EXISTS used for the availability read policies, so a
-- partner can only ever touch their own rows.
DROP POLICY IF EXISTS partner_areas_own_all ON public.partner_areas;
CREATE POLICY partner_areas_own_all ON public.partner_areas
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.team_members m
    WHERE m.id = partner_areas.partner_id AND m.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.team_members m
    WHERE m.id = partner_areas.partner_id AND m.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS partner_services_own_all ON public.partner_services;
CREATE POLICY partner_services_own_all ON public.partner_services
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.team_members m
    WHERE m.id = partner_services.partner_id AND m.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.team_members m
    WHERE m.id = partner_services.partner_id AND m.user_id = auth.uid()
  ));

-- The GRANTs. Verified against the live database rather than assumed: reading
-- pg_policies said the policy existed, and a partner still got
-- "permission denied for table partner_areas". 010 had revoked everything from
-- authenticated, and 012's grant had never been applied to this project, so the
-- policy had no table privilege behind it to run against.
--
-- This is the same trap that cost the admin team page a 403 on team_photos, and
-- the same one that is easy to repeat: a policy without a GRANT is inert, and a
-- GRANT without a policy is equally inert. Both are needed, in that order.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_areas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_services TO authenticated;

-- partner_availability_rules is deliberately NOT opened here. Weekly hours are
-- approved coverage: changing them can strand a client who already booked a
-- slot, so that stays an admin decision and the portal shows it read-only.
-- Its own UPDATE privilege stays as it is; what keeps the partner out is the
-- absence of a matching policy, and the verification below asserts that.

-- ---------------------------------------------------------------------------
-- 3. Realtime UPDATE payloads for the admin
-- ---------------------------------------------------------------------------
-- bookings is already in the supabase_realtime publication, so INSERT arrives
-- and the admin dashboard does update by itself. UPDATE arrives too, but
-- without REPLICA IDENTITY FULL Postgres only sends the primary key, so a
-- status change or a partner assignment is delivered as a reference rather
-- than a row. FULL sends the whole row, which is what the subscriber needs to
-- re-render the card.
--
-- Only set when it is not already FULL: it is a per-table rewrite of every
-- updated row, so doing it repeatedly for nothing is real work.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'bookings' AND c.relreplident = 'f'
  ) THEN
    ALTER TABLE public.bookings REPLICA IDENTITY FULL;
    RAISE NOTICE 'set REPLICA IDENTITY FULL on public.bookings';
  ELSE
    RAISE NOTICE 'public.bookings already has REPLICA IDENTITY FULL';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. City search for the coverage picker
-- ---------------------------------------------------------------------------
-- The picker has to search 1,656 cities by name as the partner types. Without
-- this the database reads every row on every keystroke, which is fine at ten
-- cities and unusable at fifteen hundred.
--
-- Case-insensitive: unaccent is not used because names are stored with their
-- real accents (Cavite City, not Cavite) and a search for "cavite" should find
-- them. Wrapped because CREATE EXTENSION needs rights a hosted project may not
-- grant, and the indexes below are worth having either way.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS unaccent;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'unaccent unavailable (%), carrying on with lower() only', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS cities_name_lower_idx ON public.cities (lower(display_name));
CREATE INDEX IF NOT EXISTS cities_province_lower_idx ON public.cities (lower(COALESCE(province_name, '')));
CREATE INDEX IF NOT EXISTS cities_code_idx ON public.cities (code);

-- Every portal load, and every partner_areas / partner_services policy check,
-- resolves a member by auth.uid(). At three rows that is free; at a few
-- hundred partners it is a sequential scan on the busiest page in the app.
CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON public.team_members (user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS team_members_email_lower_idx ON public.team_members (lower(email))
  WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_areas_partner_idx ON public.partner_areas (partner_id);
CREATE INDEX IF NOT EXISTS partner_services_partner_idx ON public.partner_services (partner_id);
CREATE INDEX IF NOT EXISTS partner_availability_rules_partner_idx ON public.partner_availability_rules (partner_id);

-- ---------------------------------------------------------------------------
-- 5. Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tables   int;
  v_policies int;
  v_cities   int;
  v_repl     "char";
  v_grants   int;
BEGIN
  SELECT count(*) INTO v_tables
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'push_devices';

  SELECT count(*) INTO v_policies
    FROM pg_policies
    WHERE schemaname = 'public' AND policyname IN
      ('push_devices_own_all','partner_areas_own_all','partner_services_own_all');

  SELECT count(*) INTO v_cities FROM public.cities;
  SELECT c.relreplident INTO v_repl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'bookings';

  -- Table privilege, not just the policy. A policy with no GRANT behind it
  -- raises "permission denied" and the catalog still shows it as present, so
  -- this has to be counted rather than assumed.
  SELECT count(*) INTO v_grants
  FROM (VALUES ('partner_areas'), ('partner_services')) AS t(name)
  WHERE has_table_privilege('authenticated', format('public.%s', t.name), 'SELECT')
    AND has_table_privilege('authenticated', format('public.%s', t.name), 'INSERT')
    AND has_table_privilege('authenticated', format('public.%s', t.name), 'UPDATE')
    AND has_table_privilege('authenticated', format('public.%s', t.name), 'DELETE');

  RAISE NOTICE 'V-018 push_devices=% | policies=% (expect 3) | full grants=% (expect 2) | cities=% | bookings relreplident=% (expect f)',
    v_tables, v_policies, v_grants, v_cities, v_repl;

  IF v_tables <> 1 OR v_policies <> 3 OR v_grants <> 2
     OR v_cities < 1000 OR v_repl <> 'f' THEN
    RAISE EXCEPTION 'V-018 FAILED: tables=% policies=% grants=% cities=% replident=%',
      v_tables, v_policies, v_grants, v_cities, v_repl;
  END IF;
END $$;

COMMIT;
