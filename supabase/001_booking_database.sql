-- ============================================================================
-- MALTO BOOKING DATABASE — Migration
--
-- Pamamaraan: idinagdag lamang ang mga bagong column/policy.
--             Walang table na dine-delete, walang data na nire-reset.
--
-- PAANO GAMITIN:
--   1. Supabase Dashboard > SQL Editor
--   2. I-paste ang BLOCK 1 > RUN  (bookings table — kailangan ito)
--   3. I-paste ang BLOCK 2 > RUN  (storage — kung may error, may fallback sa ibaba)
--   4. I-paste sa chat ang resulta ng VERIFICATION
--
-- Bakit hiwalay ang dalawang block: kung sakaling ma-deny ang paggawa ng
-- policy sa storage, hindi ma-ro-roll-back ang mahalagang bookings migration.
-- ============================================================================


-- ============================================================================
-- BLOCK 1 — BOOKINGS TABLE (kailangan ito ng booking form at admin dashboard)
-- ============================================================================
BEGIN;

-- 1.1 Bagong columns (idempotent — ligtas ulit ipatakbo)
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS price       NUMERIC(10,2);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_ref TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS photo_path  TEXT;

-- 1.2 Unique booking reference (MAL-YYYYMMDD-HHMM)
--     Ang UNIQUE ay nagpapahintulot ng maraming NULL, kaya ligtas pa rin
--     ang mga lumang row na walang booking_ref.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_booking_ref_key
  ON public.bookings (booking_ref);

-- 1.3 STATUS — eksaktong 5 halaga.
--     I-normalize muna ang mga lumang halaga BAGO ang CHECK constraint,
--     kung hindi ay mababasag ito.
UPDATE public.bookings SET status = 'New Request'
WHERE status IS NULL OR status = '' OR status = 'Under Review';

UPDATE public.bookings SET status = 'Confirmed'
WHERE status = 'Customer Confirmed';

ALTER TABLE public.bookings ALTER COLUMN status SET DEFAULT 'New Request';

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('New Request','Confirmed','In Progress','Completed','Cancelled'));

-- 1.4 Table grants
--     anon          => INSERT lang (kaya makakapag-book ang customers)
--     authenticated => SELECT + UPDATE (admin dashboard)
REVOKE ALL ON public.bookings FROM anon, authenticated;
GRANT INSERT ON public.bookings TO anon;
GRANT SELECT, UPDATE ON public.bookings TO authenticated;

-- 1.5 Row Level Security
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bookings_insert_anon ON public.bookings;
CREATE POLICY bookings_insert_anon
  ON public.bookings FOR INSERT
  TO anon
  WITH CHECK (status = 'New Request');

DROP POLICY IF EXISTS bookings_select_admin ON public.bookings;
CREATE POLICY bookings_select_admin
  ON public.bookings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS bookings_update_admin ON public.bookings;
CREATE POLICY bookings_update_admin
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Walang DELETE policy => kahit ang admin ay hindi makakabura (deliberate).

COMMIT;
-- ======== BLOCK 1 HANGGANG DITO ========


-- ============================================================================
-- BLOCK 2 — STORAGE (mga larawan)
-- Kung lalabas dito ang error na "must be owner of table objects",
-- pumunta sa Dashboard > Storage > Policies at gamitin ang fallback
-- na nakalagay sa dulo ng file na ito.
-- ============================================================================
BEGIN;

-- 2.1 Private bucket (hindi public ang mga larawan)
INSERT INTO storage.buckets (id, name, public)
VALUES ('booking-photos', 'booking-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 2.2 anon => INSERT lang, at dapat nasa MAL-* folder
DROP POLICY IF EXISTS photo_upload_anon ON storage.objects;
CREATE POLICY photo_upload_anon
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'booking-photos'
    AND name ~ '^MAL-[0-9]{8}-[0-9]{4}(-[A-Z0-9]{4})?/.+'
  );

-- 2.3 authenticated => SELECT at DELETE (tingin at pagbura ng larawan)
DROP POLICY IF EXISTS photo_read_admin ON storage.objects;
CREATE POLICY photo_read_admin
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'booking-photos');

DROP POLICY IF EXISTS photo_delete_admin ON storage.objects;
CREATE POLICY photo_delete_admin
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'booking-photos');

COMMIT;
-- ======== BLOCK 2 HANGGANG DITO ========


-- ============================================================================
-- FALLBACK (gagamitin LANG kung nag-error ang Block 2)
-- Dashboard > Storage > Policies > New policy, piliin ang Operations na
-- INSERT / SELECT / DELETE, Resources = Specific buckets > booking-photos,
-- ugaliin ang mga sumusunod:
--
--   INSERT:  bucket is booking-photos
--   SELECT:  bucket is booking-photos
--   DELETE:  bucket is booking-photos
--
-- Pagkatapos, sa Dashboard > Storage > Buckets > booking-photos > Settings,
-- i-set ang Public bucket = OFF.
-- ============================================================================


-- ============================================================================
-- VERIFICATION — i-paste ang resulta nito sa chat
-- ============================================================================

-- V1. Buong column list
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'bookings'
ORDER BY ordinal_position;

-- V2. RLS naka-on ba?
SELECT c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';

-- V3. Lahat ng policies (public at storage)
SELECT schemaname, tablename, policyname, cmd, roles, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- V4. Mga constraint
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.bookings'::regclass;

-- V5. Grants
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'bookings'
ORDER BY grantee, privilege_type;

-- V6. Row count at mga status na mayroon na
SELECT count(*) AS total_rows FROM public.bookings;
SELECT status, count(*) FROM public.bookings GROUP BY status ORDER BY 2 DESC;

-- V7. Storage bucket
SELECT id, name, public FROM storage.buckets;

-- V8. Sino ang admin user? (kung wala pa, gumawa sa Dashboard > Auth > Users)
SELECT email, created_at FROM auth.users ORDER BY created_at DESC;
