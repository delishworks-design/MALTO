-- ============================================================================
-- MALTO — Phase 1: Admin Suite database (services, pricing, team, settings,
-- email config) + bookings.admin_notes + realtime
--
-- PAANO GAMITIN: Supabase Dashboard > SQL Editor > i-paste > RUN
--    (o: supabase db query --linked -f supabase/002_admin_suite.sql)
--
-- IDempotent: ligtas ulit ipatakbo. Ang seed ay INSERT-IF-MISSING lang,
-- kaya HINDI kailanman binabago ang mga inayos mo na sa admin.
--
-- SECURITY MODEL (sundin ang README — walang internal pricing na public):
--   anon          -> SELECT lang sa services, price_cards, site_settings (kung active/is_public)
--   authenticated -> full CRUD sa lahat MALIBAN sa email_secret
--   email_secret  -> WALANG policy = service_role/postgres lang (password)
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

-- PUBLIC CONTENT: services (website + booking form)
CREATE TABLE IF NOT EXISTS public.services (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  sort_order  int  NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- PRIVATE: per-service calculator defaults (default hours + cleaners)
CREATE TABLE IF NOT EXISTS public.service_rates (
  service_id       uuid PRIMARY KEY REFERENCES public.services(id) ON DELETE CASCADE,
  default_hours    numeric(6,2) NOT NULL DEFAULT 5,
  default_cleaners int NOT NULL DEFAULT 1,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- PUBLIC CONTENT: the price cards shown on the website
CREATE TABLE IF NOT EXISTS public.price_cards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL UNIQUE,
  amount     numeric(12,2) NOT NULL,
  suffix     text NOT NULL DEFAULT '+',
  sort_order int NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- PRIVATE: price calculator rules (labor, distance, size, margin, floor)
CREATE TABLE IF NOT EXISTS public.pricing_rules (
  id                    int PRIMARY KEY DEFAULT 1,
  hourly_rate           numeric(12,2) NOT NULL DEFAULT 150,
  distance_rate_per_km  numeric(12,2) NOT NULL DEFAULT 15,
  job_size_rate_per_sqm numeric(12,2) NOT NULL DEFAULT 25,
  company_margin_pct    numeric(6,2)  NOT NULL DEFAULT 20,
  min_charge            numeric(12,2) NOT NULL DEFAULT 1000,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_rules_singleton CHECK (id = 1)
);

-- PRIVATE: employee profiles (admin-only by decision)
CREATE TABLE IF NOT EXISTS public.team_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  role       text NOT NULL DEFAULT '',
  phone      text NOT NULL DEFAULT '',
  email      text NOT NULL DEFAULT '',
  hire_date  date,
  bio        text NOT NULL DEFAULT '',
  photo_path text NOT NULL DEFAULT '',
  active     boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- PUBLIC CONTENT: website configuration (key/value)
CREATE TABLE IF NOT EXISTS public.site_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL DEFAULT '',
  is_public  boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- PRIVATE: SMTP configuration (non-secret part)
CREATE TABLE IF NOT EXISTS public.email_settings (
  id         int PRIMARY KEY DEFAULT 1,
  smtp_host  text NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port  int  NOT NULL DEFAULT 465,
  smtp_secure boolean NOT NULL DEFAULT true,
  smtp_user  text NOT NULL DEFAULT '',
  from_name  text NOT NULL DEFAULT 'MALTO Cleaning Services',
  from_email text NOT NULL DEFAULT '',
  reply_to   text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_settings_singleton CHECK (id = 1)
);

-- PRIVATE: SMTP password. RLS naka-on at WALANG policy -> service_role lang.
CREATE TABLE IF NOT EXISTS public.email_secret (
  id              int PRIMARY KEY DEFAULT 1,
  pass_encrypted  text NOT NULL DEFAULT '',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_secret_singleton CHECK (id = 1)
);

-- bookings: bagong column para sa admin-only na remarks
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS admin_notes text;

-- ---------------------------------------------------------------------------
-- 2. INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS services_sort_idx       ON public.services (sort_order);
CREATE INDEX IF NOT EXISTS price_cards_sort_idx    ON public.price_cards (sort_order);
CREATE INDEX IF NOT EXISTS team_members_sort_idx   ON public.team_members (sort_order);
CREATE INDEX IF NOT EXISTS bookings_created_at_idx ON public.bookings (created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_status_idx     ON public.bookings (status);
CREATE INDEX IF NOT EXISTS bookings_date_idx       ON public.bookings (date);

-- ---------------------------------------------------------------------------
-- 3. updated_at AUTO-TRIGGER
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'services','service_rates','price_cards','pricing_rules',
    'team_members','site_settings','email_settings','email_secret'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t, t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. GRANTS  (default: ALL ang anon/authenticated -> kailangang i-revoke muna)
-- ---------------------------------------------------------------------------
REVOKE ALL ON
  public.services, public.service_rates, public.price_cards, public.pricing_rules,
  public.team_members, public.site_settings, public.email_settings, public.email_secret
FROM anon, authenticated;

-- public read (website)
GRANT SELECT ON public.services    TO anon;
GRANT SELECT ON public.price_cards TO anon;
GRANT SELECT ON public.site_settings TO anon;

-- admin full access (walang email_secret!)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.services, public.service_rates, public.price_cards, public.pricing_rules,
  public.team_members, public.site_settings, public.email_settings
TO authenticated;

-- email_secret: WALA. service_role lamang (hindi nirerevoke).

-- ---------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE public.services      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_cards   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_secret  ENABLE ROW LEVEL SECURITY;

-- services
DROP POLICY IF EXISTS services_public_read ON public.services;
CREATE POLICY services_public_read ON public.services
  FOR SELECT TO anon USING (active = true);
DROP POLICY IF EXISTS services_admin_all ON public.services;
CREATE POLICY services_admin_all ON public.services
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- service_rates (walang anon = private)
DROP POLICY IF EXISTS service_rates_admin_all ON public.service_rates;
CREATE POLICY service_rates_admin_all ON public.service_rates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- price_cards
DROP POLICY IF EXISTS price_cards_public_read ON public.price_cards;
CREATE POLICY price_cards_public_read ON public.price_cards
  FOR SELECT TO anon USING (active = true);
DROP POLICY IF EXISTS price_cards_admin_all ON public.price_cards;
CREATE POLICY price_cards_admin_all ON public.price_cards
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- pricing_rules (PRIVATE - README: walang internal pricing na public)
DROP POLICY IF EXISTS pricing_rules_admin_all ON public.pricing_rules;
CREATE POLICY pricing_rules_admin_all ON public.pricing_rules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- team_members (admin-only by decision)
DROP POLICY IF EXISTS team_members_admin_all ON public.team_members;
CREATE POLICY team_members_admin_all ON public.team_members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- site_settings
DROP POLICY IF EXISTS site_settings_public_read ON public.site_settings;
CREATE POLICY site_settings_public_read ON public.site_settings
  FOR SELECT TO anon USING (is_public = true);
DROP POLICY IF EXISTS site_settings_admin_all ON public.site_settings;
CREATE POLICY site_settings_admin_all ON public.site_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- email_settings (admin lang; password ay hiwalay na table)
DROP POLICY IF EXISTS email_settings_admin_all ON public.email_settings;
CREATE POLICY email_settings_admin_all ON public.email_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- email_secret: WALANG POLICY (dito nakasalalay ang kaligtasan ng password)

-- ---------------------------------------------------------------------------
-- 6. REALTIME (bagong booking lumitaw nang walang refresh)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'bookings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
  END IF;
END $$;

COMMIT;


-- ============================================================================
-- 7. SEED — INSERT-IF-MISSING LANG (hindi kailanman mag-o-override ng edits)
-- ============================================================================
BEGIN;

-- 7.1 Services (galing sa kasalukuying hardcoded homepage)
INSERT INTO public.services (name, description, sort_order) VALUES
  ('Home Cleaning',     'Regular cleaning for apartments, condos and homes.', 1),
  ('Deep Cleaning',     'For spaces needing extra attention.',               2),
  ('Move-In / Move-Out','Preparing a space for its next chapter.',           3),
  ('Small Business',    'Cleaning support for offices, shops and studios.',  4)
ON CONFLICT (name) DO NOTHING;

-- 7.2 Default hours + cleaners kada service (base sa dating estimate logic:
--     Deep Cleaning = 6hrs/2, ang iba = 5hrs; malaking espasyo = 2 cleaners)
INSERT INTO public.service_rates (service_id, default_hours, default_cleaners)
SELECT s.id, v.hours, v.cleaners
FROM public.services s
JOIN (
  SELECT * FROM (VALUES
    ('Home Cleaning',      5::numeric, 1),
    ('Deep Cleaning',      6::numeric, 2),
    ('Move-In / Move-Out', 6::numeric, 2),
    ('Small Business',     5::numeric, 2)
  ) AS v(name, hours, cleaners)
) v ON v.name = s.name
ON CONFLICT (service_id) DO NOTHING;

-- 7.3 Price cards (eksaktong kasalukuying 8 cards ng website)
INSERT INTO public.price_cards (label, amount, suffix, sort_order) VALUES
  ('Studio / Room',     1300, '+', 1),
  ('1BR',               1650, '+', 2),
  ('2BR',               2800, '+', 3),
  ('3BR',               3400, '+', 4),
  ('Small House',       4000, '+', 5),
  ('Deep Cleaning',     3500, '+', 6),
  ('Move-In / Move-Out',3500, '+', 7),
  ('Small Office',      2800, '+', 8)
ON CONFLICT (label) DO NOTHING;

-- 7.4 Pricing rules (unang beses lang; defaults ay MAPAPALITAN sa admin)
INSERT INTO public.pricing_rules (id)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.pricing_rules);

-- 7.5 Email settings
INSERT INTO public.email_settings (id, smtp_host, smtp_port, smtp_secure, smtp_user, from_name, from_email, reply_to)
SELECT 1, 'smtp.gmail.com', 465, true, 'Delishworks@gmail.com',
       'MALTO Cleaning Services', 'Delishworks@gmail.com', 'Delishworks@gmail.com'
WHERE NOT EXISTS (SELECT 1 FROM public.email_settings);

-- 7.6 Email secret row (password = nakaimbak na naka-encrypt; walang laman sa seed)
INSERT INTO public.email_secret (id)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.email_secret);

-- 7.7 Website configuration (eksaktong teksto ng kasalukuying website)
INSERT INTO public.site_settings (key, value) VALUES
  ('hero_headline',        'A Better Standard of Clean.'),
  ('hero_lead',            'Reliable cleaning services for homes and small businesses.'),
  ('hero_note',            'Quietly premium. Locally focused. Thoughtful about the work and transparent about the service.'),
  ('footer_tagline',       'A Better Standard of Clean.'),
  ('cta_primary',          'BOOK A CLEANING'),
  ('cta_secondary',        'VIEW SERVICES'),
  ('cta_estimate',         'GET AN ESTIMATE'),
  ('services_lead',        'Practical cleaning services designed around your space, its condition and the scope of work required.'),
  ('services_heading',     'Cleaning, thoughtfully scoped.'),
  ('pricing_heading',      'Starting prices.'),
  ('pricing_lead',         'Cleaning services starting from ₱1,300+. Final pricing depends on size, condition, scope, number of cleaners, location and materials.'),
  ('pricing_starting_from','₱1,300+'),
  ('pricing_disclaimer',   'Final pricing depends on property size, condition, cleaning scope, number of cleaners, estimated hours, location and materials.'),
  ('about_heading',        'Small Team. Serious About the Work.'),
  ('about_title',          'Small Team. Serious About the Work.'),
  ('about_body',           'We focus on careful service, transparent pricing, flexible cleaning options and professional presentation.'),
  ('about_lead',           'MALTO is a local cleaning service focused on reliable service, careful work, transparent pricing and professional presentation.'),
  ('contact_heading',      'Tell us about your space.'),
  ('contact_lead',         'For cleaning requests, use the booking form so MALTO can review the scope, location, availability and pricing.'),
  ('contact_phone',        ''),
  ('contact_email',        ''),
  ('contact_address',      ''),
  ('contact_hours',        ''),
  ('seo_title',            'MALTO Cleaning Services | A Better Standard of Clean.'),
  ('seo_description',      'Reliable cleaning services for homes and small businesses. Home cleaning, deep cleaning and move-in / move-out with transparent pricing.'),
  ('faq_heading',          'Frequently asked questions.'),
  ('faq_items',            '[{"q":"Do I need to provide cleaning supplies?","a":"You may provide materials, or MALTO can provide them for an additional fee."},{"q":"What if my home is very dirty?","a":"Please indicate the condition during booking so MALTO can estimate the appropriate scope, time and number of cleaners."},{"q":"Do you offer same-day availability?","a":"Subject to availability."},{"q":"Is the price shown on the website final?","a":"No. The website provides starting prices and estimates. Final pricing is confirmed after MALTO reviews the request."}]')
ON CONFLICT (key) DO NOTHING;

COMMIT;


-- ============================================================================
-- VERIFICATION — i-paste ang resulta sa chat
-- ============================================================================

-- V-A: mga table + row count
SELECT 'services' t, count(*)::text n FROM public.services
UNION ALL SELECT 'service_rates', count(*)::text FROM public.service_rates
UNION ALL SELECT 'price_cards', count(*)::text FROM public.price_cards
UNION ALL SELECT 'pricing_rules', count(*)::text FROM public.pricing_rules
UNION ALL SELECT 'team_members', count(*)::text FROM public.team_members
UNION ALL SELECT 'site_settings', count(*)::text FROM public.site_settings
UNION ALL SELECT 'email_settings', count(*)::text FROM public.email_settings
UNION ALL SELECT 'email_secret', count(*)::text FROM public.email_secret
UNION ALL SELECT 'bookings', count(*)::text FROM public.bookings;

-- V-B: RLS naka-on ba lahat?
SELECT relname, relrowsecurity AS rls
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND relkind='r' ORDER BY relname;

-- V-C: policies
SELECT schemaname||'.'||tablename||' | '||policyname||' | '||cmd||' | to='||array_to_string(roles,'+')
FROM pg_policies WHERE schemaname='public' ORDER BY 1;

-- V-D: grants (dapat WALANG anon sa service_rates/pricing_rules/team_members/email_*)
SELECT grantee||' -> '||table_name||': '||privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name IN ('services','service_rates','price_cards','pricing_rules',
                     'team_members','site_settings','email_settings','email_secret')
ORDER BY table_name, grantee, privilege_type;

-- V-E: bookings.admin_notes umiiral?
SELECT column_name||' | '||data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='bookings' AND column_name='admin_notes';

-- V-F: realtime publication
SELECT pubname, schemaname, tablename FROM pg_publication_tables
WHERE pubname='supabase_realtime' ORDER BY 3;

-- V-G: sanity — dapat FAILURE ang anon na basahin ang pricing_rules
--      (patakbuhin ito sa SQL Editor at inaasahan ang "permission denied")
SELECT count(*) FROM public.pricing_rules;
