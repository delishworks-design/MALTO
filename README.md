# MALTO Cleaning Services

A Better Standard of Clean.

A cleaning marketplace: customers book and get an instant estimate, an approved
cleaner accepts the job, and MALTO handles the quote, the customer and the
notifications in between.

## Stack

- Next.js 14, App Router
- React 18, TypeScript
- Supabase — Postgres, Auth, Storage, Realtime, and RLS on every table
- Capacitor — the partner Android app
- VAPID web push in the browser, FCM in the app
- Nodemailer against a custom SMTP relay, with a retrying outbox
- Plain CSS with a token-based design system; no UI framework, no external fonts
  or stock images

## Running it

```
npm install
npm run dev
```

## Checks

```
npx tsc --noEmit        # types
npm run lint            # ESLint
npm run build           # production build
```

`npm run lint` used to hang on an interactive ESLint setup prompt, because no
config had ever been committed. That is fixed; see `.eslintrc.json`.

## Project-specific scripts

```
npm run test:app-release        # version comparison rules
node --experimental-strip-types scripts/test-portal-identity.ts
node scripts/verify-018.mjs     # proves the partner RLS with a real jwt claim
node scripts/check-notification-assets.mjs
node scripts/test-fcm.mjs       # the push send path
node scripts/db.mjs query "select 1"      # needs SUPABASE_ACCESS_TOKEN
node scripts/upload-app-release.mjs android/app/build/outputs/apk/release/app-release.apk
node scripts/align-apk.mjs --check <apk>
```

## Deployment

Live at `https://malto-cleaning-services.vercel.app`, deployed from `main` with
an explicit `vercel --prod`. Pushing to `main` does **not** deploy it; that has
caught people out more than once.

Supabase migrations are plain SQL in `supabase/`, numbered and idempotent.
`scripts/db.mjs apply supabase/0NN_*.sql` runs one through the Management API,
so a migration does not need pasting into the dashboard by hand.

## Layout

- `app/` — public site, `/book`, `/portal` (partner), `/admin` (staff), `/join`
- `lib/` — site data, push, portal cache, identity rules
- `supabase/` — schema, RLS policies, functions
- `android/` — the Capacitor app shell
- `components/portal/` — the partner app's shared chrome
- `scripts/` — build, verification and database tooling

## Partner and admin are different systems

Both sign in with Supabase Auth, but they answer different questions against
different tables:

- **`/portal`** — the cleaner. `team_members`, gated on `portal_status` being
  `approved`. Registration happens in the Android app.
- **`/admin`** — the staff. The `admins` table, gated on `is_admin()`. A staff
  account is refused at the partner sign-in form rather than being let in.

`lib/portal-identity.ts` decides which of the five states a signed-in person is
in. Only `signed-out` and `staff` are allowed to redirect; the rest render a
screen. That rule exists because the earlier arrangement, where the portal and
the middleware each redirected the other, produced a loop that ran on every
visit for any account without a partner row.

## Secrets

None of these are in the repository, and the repository is public.

- Firebase service account — GitHub secret `MALTO_FIREBASE_SERVICE_ACCOUNT`, and
  `site_settings.push_fcm_secret` with `is_public = false`
- Supabase access token — `/root/malto-signing/supabase-access-token.txt`
- Android signing keystore — `/root/malto-signing/malto-release.jks`, password
  alongside it in `CREDENTIALS.txt`
- SMTP and encryption keys — Vercel environment, and `email_secret` in the
  database, which no role can read

A lost Android keystore cannot be replaced: every installed app becomes
unupdatable and each cleaner has to uninstall, losing their session. Back it up
somewhere that is not one machine.

## Known gaps

- Push notifications cannot send yet. The service account lacks
  `roles/firebasecloudmessaging.admin`; everything else is in place and the
  rest of the app works without it.
- The legal copy — terms, privacy and the partner agreement — is written and
  published, but has not been through a lawyer.
- Reviews and ratings are not implemented, so a partner gets no feedback.
- The app has never been run on a physical device. No emulator or device is
  available in this environment.
- In-app recurring booking management is missing: the discounts work in the
  customer booking flow, but a cleaner has no view of their recurring clients.
