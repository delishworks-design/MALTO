-- 017_app_downloads.sql
-- Hosting for the Android partner app.
--
-- The APK is distributed by download from the website rather than through the
-- Play Store: the partners are independent cleaners we onboard by hand, and a
-- store listing would be a much larger commitment for no benefit to them. That
-- makes the bucket public on purpose, so the download works without an auth
-- round trip and without a signed URL expiring under someone's finger.
--
-- Nothing secret lives here. The APK, its version and its checksum are already
-- handed out to anyone who wants the app.
--
-- Idempotent: safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Public bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('app-downloads', 'app-downloads', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- No anon write policies on purpose. Public means the SELECT policies that
-- Supabase attaches to a public bucket are enough to read it; inserting,
-- replacing or deleting an APK is a service_role operation run by
-- scripts/upload-app-release.ts. Leaving the insert path closed matters here
-- more than for the photo buckets: an anon insert would let anyone replace
-- the binary that cleaners install.

-- ---------------------------------------------------------------------------
-- 2. Settings rows
-- ---------------------------------------------------------------------------
-- is_public = true so the anon client can read them, which is how /join and
-- /api/app/version resolve the download without an admin session. Same rule the
-- rest of site_settings already follows.
--
-- partner_app_url is left empty on purpose. It is filled in by the upload
-- script once a real build exists; /join is written to degrade to a plain link
-- to the web portal while it is empty, so an admin who forgets to upload does
-- not end up with a dead button.

INSERT INTO public.site_settings (key, value, is_public) VALUES
  ('partner_app_url',        '',       true),
  ('partner_app_version',    '',       true),
  ('partner_app_min_version','',       true),
  ('partner_app_size_mb',    '',       true),
  ('partner_app_sha256',     '',       true),
  ('partner_app_updated_at', '',       true)
ON CONFLICT (key) DO UPDATE SET is_public = true;

-- ---------------------------------------------------------------------------
-- 3. Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bucket_public boolean;
  v_policies      int;
  v_keys          int;
  v_anon_writes   int;
BEGIN
  SELECT public INTO v_bucket_public FROM storage.buckets WHERE id = 'app-downloads';
  SELECT count(*) INTO v_policies
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'app_download%';

  -- the six keys above, regardless of whether a build has been uploaded yet
  SELECT count(*) INTO v_keys
    FROM public.site_settings
    WHERE key IN (
      'partner_app_url','partner_app_version','partner_app_min_version',
      'partner_app_size_mb','partner_app_sha256','partner_app_updated_at'
    ) AND is_public = true;

  -- any policy that would let anon or authenticated write into the bucket
  SELECT count(*) INTO v_anon_writes
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'app_download%'
      AND (roles::text LIKE '%anon%' OR roles::text LIKE '%authenticated%')
      AND cmd <> 'SELECT';

  RAISE NOTICE 'V-017 bucket public=% | app policies=% | settings keys=% | anon write policies=% (expect true/0/6/0)',
    v_bucket_public, v_policies, v_keys, v_anon_writes;

  IF v_bucket_public IS DISTINCT FROM true
     OR v_keys <> 6
     OR v_anon_writes <> 0 THEN
    RAISE EXCEPTION 'V-017 FAILED: bucket=% keys=% anon_writes=%', v_bucket_public, v_keys, v_anon_writes;
  END IF;
END $$;

COMMIT;
