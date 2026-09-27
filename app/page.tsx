import Link from "next/link";
import { getSiteData, formatPrice, REVALIDATE } from "@/lib/site";
import { supabase } from "@/lib/supabase";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { PartnerAvatar, type Partner } from "@/app/partners/page";

export const revalidate = REVALIDATE;

export async function generateMetadata() {
  const d = await getSiteData();
  return { title: d.seo.title, description: d.seo.description };
}

const HOW = [
  { t: "Tell us about your place", b: "Service, size, and where you are. A few taps, no account needed." },
  { t: "Pick a cleaner, or don't", b: "Choose someone from our partners, or leave it to us and we match you with the best available." },
  { t: "See the real price", b: "We review the request, confirm the time, and send a fixed quote. Nothing is charged before you accept it." },
  { t: "We get to work", b: "The cleaner you chose, or the one we assigned, arrives inside the agreed window." },
];

export default async function Home() {
  const d = await getSiteData();
  const s = d.s;

  // The homepage shows the same partners the directory does, from the same
  // view, so a sample can never appear here without its badge.
  const { data: partnerRows } = await supabase
    .from("public_partners")
    .select("*")
    .order("sort_order")
    .order("name")
    .limit(4);
  const partners = (partnerRows ?? []) as Partner[];
  const realPartners = partners.filter((p) => !p.is_sample);

  return <main>
    <SiteHeader />

    <section className="hero"><div className="container hero-grid">
      <div>
        <div className="eyebrow">MALTO CLEANING SERVICES</div>
        <h1>{s("hero_headline")}</h1>
        <p className="lead">{s("hero_lead")}</p>
        <div className="actions">
          <Link className="btn" href="/book">{s("cta_primary")}</Link>
          <Link className="btn secondary" href="/partners">Meet our cleaners</Link>
        </div>
        <p className="small muted" style={{ marginTop: "18px" }}>{s("hero_note")}</p>
      </div>
      <aside className="hero-panel">
        <h2 className="hero-panel-title">Why book through MALTO?</h2>
        <ul className="ticks">
          <li>Vetted cleaners, with profiles you can read first</li>
          <li>Choose who comes, or let us assign someone</li>
          <li>Live availability and a confirmed time window</li>
          <li>One fixed quote before any work starts</li>
        </ul>
        <Link className="btn secondary" href="/how-it-works">How it works</Link>
      </aside>
    </div></section>

    {/* The marketplace in one glance. Hidden entirely when nobody is listed
        yet, rather than showing an empty shelf on the front page. */}
    {partners.length > 0 && (
      <section className="section tight" id="partners">
        <div className="container">
          <div className="section-head">
            <h2>The people who come to your home</h2>
            <p>
              Every cleaner on MALTO is approved, has signed our partner agreement, and sets their own hours.
            </p>
          </div>
          <div className="partner-grid">
            {partners.map((p) => (
              <article className="pcard" key={p.id}>
                <div className="pcard-top">
                  <PartnerAvatar partner={p} size={64} />
                  <div className="pcard-id">
                    <h3><Link href={`/partners/${p.slug}`}>{p.name}</Link></h3>
                    {p.headline && <p className="pcard-headline">{p.headline}</p>}
                    <div className="pcard-flags">
                      {p.is_sample && <span className="badge warn">Sample</span>}
                      {p.verified && <span className="badge on">Verified</span>}
                      {p.years_experience > 0 && <span className="badge">{p.years_experience} yr{p.years_experience === 1 ? "" : "s"}</span>}
                    </div>
                  </div>
                </div>
                {!!p.areas?.length && <p className="pcard-row"><span>Areas</span> {p.areas.slice(0, 3).join(" · ")}</p>}
                <div className="pcard-actions">
                  <Link className="btn secondary" href={`/partners/${p.slug}`}>View profile</Link>
                </div>
              </article>
            ))}
          </div>
          <div className="actions center">
            <Link className="btn secondary" href="/partners">
              {realPartners.length > 0 ? "See all our cleaners" : "Browse cleaners"}
            </Link>
          </div>
        </div>
      </section>
    )}

    <section className="section" id="services">
      <div className="container">
        <div className="section-head"><h2>What we clean</h2><p>{s("services_lead")}</p></div>
        <div className="grid4">
          {d.services.map((x) => (
            <article className="card" key={x.name}><h3>{x.name}</h3><p>{x.description}</p></article>
          ))}
        </div>
      </div>
    </section>

    <section className="section alt" id="how">
      <div className="container">
        <div className="section-head">
          <h2>How it works</h2>
          <p>A request, a confirmed price, and a cleaner you know is coming.</p>
        </div>
        <div className="steps">
          {HOW.map((x, i) => (
            <div className="step" key={x.t}><div className="step-num">0{i + 1}</div><h3>{x.t}</h3><p>{x.b}</p></div>
          ))}
        </div>
      </div>
    </section>

    <section className="section" id="pricing">
      <div className="container">
        <div className="section-head"><h2>Pricing</h2><p>{s("pricing_lead")}</p></div>
        <div className="price-grid">
          {d.cards.map((x) => <div className="price" key={x.label}><span className="small">{x.label}</span><strong>{formatPrice(x.amount, x.suffix)}</strong></div>)}
        </div>
        <p className="small muted" style={{ marginTop: "18px" }}>
          Booking on a schedule lowers the price per visit. The final price is always confirmed with you before
          any work starts.
        </p>
        <div className="actions"><Link className="btn" href="/book">{s("cta_estimate")}</Link></div>
      </div>
    </section>

    {/* Recurring booking is a different product decision, so it gets its own
        explanation rather than a line in the pricing table. */}
    {d.plans.filter((p) => p.frequency !== "once").length > 0 && (
      <section className="section alt" id="recurring">
        <div className="container">
          <div className="section-head">
            <h2>Book it once, keep it clean</h2>
            <p>Set it up on a schedule and the same visit repeats. You are reminded before each one.</p>
          </div>
          <div className="grid4">
            {d.plans.filter((p) => p.frequency !== "once").map((p) => (
              <div className="card" key={p.frequency}>
                <h3>{p.clientLabel || p.label}</h3>
                {p.discountPct > 0 && <p className="small" style={{ color: "var(--sage)", fontWeight: 600 }}>Save {p.discountPct}%</p>}
              </div>
            ))}
          </div>
        </div>
      </section>
    )}

    <section className="section" id="faq">
      <div className="container">
        <div className="section-head"><h2>Questions people ask</h2></div>
        <div className="faq">
          {d.faq.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
        </div>
      </div>
    </section>

    <section className="section alt" id="partners-join">
      <div className="container join-grid">
        <div>
          <div className="eyebrow">FOR CLEANERS</div>
          <h2>Clean with MALTO</h2>
          <p className="lead">
            You are an independent partner, not an employee. You choose the services you take, the cities you
            cover, and your own working hours. We handle the booking, the quote and the customer.
          </p>
          <div className="actions">
            <Link className="btn" href="/portal/register">Become a partner</Link>
            <Link className="btn secondary" href="/terms">Read the terms</Link>
          </div>
        </div>
        <ul className="ticks big">
          <li>Set your own schedule and days off</li>
          <li>Get matched with jobs in your area</li>
          <li>Clear terms on scope, payment and liability</li>
          <li>A public profile you can be found through</li>
        </ul>
      </div>
    </section>

    <section className="section">
      <div className="container center">
        <h2>Ready for a better standard of clean?</h2>
        <p className="lead">Tell us about your place and we will come back with a price and a time.</p>
        <div className="actions center"><Link className="btn" href="/book">{s("cta_primary")}</Link></div>
      </div>
    </section>

    <SiteFooter tagline={s("footer_tagline")} />
  </main>;
}
