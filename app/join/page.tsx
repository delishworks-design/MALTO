import type { Metadata } from "next";
import Link from "next/link";
import { getSiteData, REVALIDATE } from "@/lib/site";
import { supabase } from "@/lib/supabase";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { APP_SETTING_KEYS, downloadUrl, releaseLabel, toAppRelease } from "@/lib/app-release";

export const revalidate = REVALIDATE;

export const metadata: Metadata = {
  title: "Become a Cleaner Partner | MALTO Cleaning Services",
  description:
    "Clean with MALTO as an independent partner. Set your own services, cities and working hours, and get matched with bookings in your area. Download the partner app for Android.",
  alternates: { canonical: "/join" },
};

const STEPS = [
  {
    n: "1",
    title: "Register and read the agreement",
    body: "Tell us who you are, which services you offer and where you can travel. You will see the partner agreement in full before you sign anything, and nothing is charged to join.",
  },
  {
    n: "2",
    title: "We confirm and publish your profile",
    body: "We check your details and mark your profile as verified. Clients can then find you in the directory and request you by name when they book.",
  },
  {
    n: "3",
    title: "You take the jobs you want",
    body: "Bookings arrive in the app or on the website. You accept the work, agree the scope, and the client sees your price confirmed in writing.",
  },
];

export default async function JoinPage() {
  const d = await getSiteData();
  const s = d.s;

  // Read as a plain key/value lookup so publishing a new build needs no deploy.
  // Empty until an admin runs scripts/upload-app-release.mjs, which is why every
  // part of the download section below is conditional.
  const { data } = await supabase
    .from("site_settings")
    .select("key,value")
    .in("key", [...APP_SETTING_KEYS]);

  const release = toAppRelease(data);
  const apk = downloadUrl(release.url);

  return <main>
    <SiteHeader />
    <SiteFooter tagline={s("footer_tagline")} />

    <div className="container page-head">
      <div className="eyebrow">FOR CLEANERS</div>
      <h1>Clean with MALTO</h1>
      <p className="lead">
        You are an independent partner, not an employee. You choose the services you take, the cities you
        cover and your own working hours. We handle the booking, the quote and the customer.
      </p>
      <div className="actions">
        <Link className="btn" href="#app">Get the partner app</Link>
        <Link className="btn secondary" href="/partners">See the directory</Link>
      </div>
    </div>

    <section className="section">
      <div className="container">
        <div className="section-head"><h2>What partnership means</h2></div>
        <div className="grid-2">
          <ul className="ticks big">
            <li>Set your own schedule and days off</li>
            <li>Get matched with jobs in your area</li>
            <li>Clear terms on scope, payment and liability</li>
            <li>A public profile you can be found through</li>
          </ul>
          <ul className="ticks big">
            <li>Clients can request you by name, or leave it to us</li>
            <li>Estimates go out instantly, quotes are confirmed by you</li>
            <li>No exclusivity, and no minimum number of jobs</li>
            <li>Your contact details are never published</li>
          </ul>
        </div>
      </div>
    </section>

    <section className="section alt">
      <div className="container">
        <div className="section-head"><h2>How to get started</h2></div>
        <ol className="steps">
          {STEPS.map((step) => (
            <li key={step.n}>
              <span className="step-n">{step.n}</span>
              <div>
                <h3>{step.title}</h3>
                <p className="muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>

    <section className="section" id="app">
      <div className="container grid-2 app-promo">
        <div>
          <div className="eyebrow">PARTNER APP</div>
          <h2>Bookings on your phone</h2>
          <p className="lead">
            {release.version
              ? <>The partner app for Android shows your bookings, your schedule and your profile, and tells you when a new job comes in. It is version {releaseLabel(release)}.</>
              : <>The partner app for Android shows your bookings, your schedule and your profile, and tells you when a new job comes in.</>}
          </p>
          <p className="small muted">
            You can do everything in the app on the website instead, which works on any phone. The app is
            simply the faster way to use it.
          </p>

          {apk ? (
            <div className="download-card">
              <a className="btn" href={apk} rel="noopener">Download for Android</a>
              <dl className="release-meta">
                <div><dt>Version</dt><dd>{releaseLabel(release)}</dd></div>
                <div><dt>Size</dt><dd>{release.sizeMb ? `${release.sizeMb} MB` : "—"}</dd></div>
                <div>
                  <dt>Checksum</dt>
                  <dd>
                    <code title={release.sha256}>{release.sha256 ? `${release.sha256.slice(0, 16)}…` : "—"}</code>
                  </dd>
                </div>
                {release.updatedAt && (
                  <div><dt>Published</dt><dd>{new Date(release.updatedAt).toISOString().slice(0, 10)}</dd></div>
                )}
              </dl>
            </div>
          ) : (
            <div className="empty-state">
              <h3>The app is not published yet.</h3>
              <p>
                Use the <Link href="/portal">partner portal on the website</Link> in the meantime. It does
                everything the app does.
              </p>
            </div>
          )}
        </div>

        <div>
          <h3>Installing it</h3>
          <ol className="steps compact">
            <li><div><p>Open the download link on your Android phone and confirm the download.</p></div></li>
            <li>
              <div>
                <p>
                  Android will ask whether it may install apps from this source. Tap{" "}
                  <strong>Settings</strong>, then <strong>Allow from this source</strong>.
                </p>
              </div>
            </li>
            <li><div><p>Open the downloaded file and tap <strong>Install</strong>.</p></div></li>
            <li><div><p>Sign in with the email and password you registered with.</p></div></li>
          </ol>
          <p className="small muted">
            The app is not in the Play Store, so that extra prompt is expected. It is the same prompt any
            app downloaded outside the store shows.
          </p>
          <p className="small muted">
            <strong>On an iPhone?</strong>{" "}
            <Link href="/portal">Use the partner portal on the website</Link> — it works the same way and
            nothing is lost.
          </p>
        </div>
      </div>
    </section>

    <section className="section alt">
      <div className="container center narrow">
        <h2>Ready to start?</h2>
        <p className="lead">
          Register, read the agreement, and we will confirm your details and publish your profile.
        </p>
        <div className="actions center">
          <Link className="btn" href="#app">Get the partner app</Link>
          <Link className="btn secondary" href="/terms">Read the terms</Link>
        </div>
      </div>
    </section>
  </main>;
}
