import Link from "next/link";
import { getSiteData, REVALIDATE, type Frequency } from "@/lib/site";
import { supabase } from "@/lib/supabase";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

export const revalidate = REVALIDATE;

export type Partner = {
  id: string;
  slug: string;
  name: string;
  headline: string;
  tagline: string;
  bio: string;
  photo_path: string;
  years_experience: number;
  verified: boolean;
  is_accepting_jobs: boolean;
  is_sample: boolean;
  specialties: string[] | null;
  areas: string[] | null;
  /** Same places, always qualified with the province, for a profile page. */
  area_labels: string[] | null;
  jobs_completed: number;
};

// From the environment rather than hardcoded, so a staging or preview deploy
// reads its own bucket instead of this project's.
export const PHOTO_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/team-photos`;

/** Falls back to initials so a missing photo never shows a broken image. */
export function PartnerAvatar({ partner, size = 72 }: { partner: Partner; size?: number }) {
  const initials = partner.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  if (!partner.photo_path) {
    return (
      <span className="avatar-fallback" style={{ width: size, height: size, fontSize: size / 2.6 }}>
        {initials || "?"}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${PHOTO_BASE}/${partner.photo_path}`}
      alt=""
      width={size}
      height={size}
      className="avatar"
      style={{ width: size, height: size }}
    />
  );
}

export async function generateMetadata() {
  const d = await getSiteData();
  return {
    title: `Our cleaning partners | MALTO Cleaning Services`,
    description:
      "Browse the cleaning partners on MALTO, see where they work and what they take on, then request a booking.",
  };
}

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; city?: string; available?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const d = await getSiteData();
  const s = d.s;

  const { data: partners, error } = await supabase
    .from("public_partners")
    .select("*")
    .order("sort_order")
    .order("name");

  if (error) {
    return <main>
      <SiteHeader />
      <div className="container section">
        <h1>Our partners</h1>
        <p className="text">The partner list could not be loaded just now. Please try again shortly.</p>
      </div>
      <SiteFooter tagline={s("footer_tagline")} />
    </main>;
  }

  const all: Partner[] = (partners ?? []) as Partner[];

  // Filter options come from the data, so a specialty or city nobody offers
  // never appears as a dead filter.
  const serviceOptions = Array.from(new Set(all.flatMap((p) => p.specialties ?? []))).sort();
  const cityOptions = Array.from(new Set(all.flatMap((p) => p.areas ?? []))).sort();

  const wanted = sp.service ?? "";
  const wantedCity = sp.city ?? "";
  const wantAvailable = sp.available === "1";
  const sort = sp.sort ?? "name";

  const filtered = all.filter((p) => {
    if (wanted && !(p.specialties ?? []).includes(wanted)) return false;
    if (wantedCity && !(p.areas ?? []).includes(wantedCity)) return false;
    if (wantAvailable && !p.is_accepting_jobs) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "experience") return b.years_experience - a.years_experience;
    if (sort === "jobs") return b.jobs_completed - a.jobs_completed;
    return a.name.localeCompare(b.name);
  });

  const hasSamples = all.some((p) => p.is_sample);
  const someVisible = all.some((p) => !p.is_sample);
  const withQuery = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { service: wanted, city: wantedCity, available: wantAvailable ? "1" : "", sort, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/partners?${qs}` : "/partners";
  };

  return <main>
    <SiteHeader />
    <SiteFooter tagline={s("footer_tagline")} />

    <div className="container page-head">
      <div className="eyebrow">OUR PARTNERS</div>
      <h1>Choose who comes to your home.</h1>
      <p className="lead">
        Every partner here has been approved by MALTO and accepted our partner agreement. You can pick one
        when you book, or leave it to us.
      </p>
    </div>

    <div className="container">
      {all.length === 0 ? (
        <div className="empty-state">
          <h2>Partners are being onboarded.</h2>
          <p>
            We are inviting our cleaners now and the list will fill in as each profile is approved. You can
            still book in the meantime and we will match you with the best available partner.
          </p>
          <div className="empty-actions">
            <Link className="btn" href="/book">BOOK A CLEANING</Link>
            <Link className="btn secondary" href="/portal/register">Become a partner</Link>
          </div>
        </div>
      ) : (
        <>
          <form className="filters" method="get" action="/partners">
            <div className="filter">
              <label htmlFor="f-service">Service</label>
              <select id="f-service" name="service" defaultValue={wanted}>
                <option value="">All services</option>
                {serviceOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="filter">
              <label htmlFor="f-city">City</label>
              <select id="f-city" name="city" defaultValue={wantedCity}>
                <option value="">All cities</option>
                {cityOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="filter">
              <label htmlFor="f-available">Availability</label>
              <select id="f-available" name="available" defaultValue={wantAvailable ? "1" : ""}>
                <option value="">Any</option>
                <option value="1">Taking jobs now</option>
              </select>
            </div>
            <div className="filter">
              <label htmlFor="f-sort">Sort</label>
              <select id="f-sort" name="sort" defaultValue={sort}>
                <option value="name">Name</option>
                <option value="experience">Most experienced</option>
                <option value="jobs">Most jobs done</option>
              </select>
            </div>
            <button className="btn filter-go" type="submit">APPLY</button>
          </form>

          {hasSamples && someVisible && (
            <p className="notice sample-notice">
              Some partners below are examples while we onboard the team. They are marked SAMPLE and cannot be
              booked.
            </p>
          )}

          {sorted.length === 0 ? (
            <div className="empty-state">
              <h2>No partners match those filters.</h2>
              <p>Try widening the service or city, or book and we will find someone for you.</p>
              <div className="empty-actions">
                <Link className="btn secondary" href={withQuery({ service: undefined, city: undefined })}>
                  Clear filters
                </Link>
                <Link className="btn" href="/book">BOOK A CLEANING</Link>
              </div>
            </div>
          ) : (
            <div className="partner-grid">
              {sorted.map((p) => <PartnerCard key={p.id} partner={p} />)}
            </div>
          )}
        </>
      )}
    </div>
  </main>;
}

function PartnerCard({ partner: p }: { partner: Partner }) {
  return (
    <article className="pcard">
      <div className="pcard-top">
        <PartnerAvatar partner={p} />
        <div className="pcard-id">
          <h3>
            <Link href={`/partners/${p.slug}`}>{p.name}</Link>
          </h3>
          {p.headline && <p className="pcard-headline">{p.headline}</p>}
          <div className="pcard-flags">
            {p.is_sample && <span className="badge warn">Sample</span>}
            {p.verified && <span className="badge on">Verified</span>}
            {!p.is_accepting_jobs && <span className="badge">Not taking jobs</span>}
          </div>
        </div>
      </div>

      {p.tagline && <p className="pcard-tagline">{p.tagline}</p>}

      <dl className="pcard-facts">
        <div>
          <dt>Experience</dt>
          <dd>{p.years_experience > 0 ? `${p.years_experience} yr${p.years_experience === 1 ? "" : "s"}` : "—"}</dd>
        </div>
        <div>
          <dt>Jobs completed</dt>
          <dd>{p.jobs_completed}</dd>
        </div>
      </dl>

      {!!p.specialties?.length && (
        <p className="pcard-row"><span>Services</span> {p.specialties.join(" · ")}</p>
      )}
      {!!p.areas?.length && (
        <p className="pcard-row"><span>Areas</span> {p.areas.join(" · ")}</p>
      )}

      <div className="pcard-actions">
        <Link className="btn secondary" href={`/partners/${p.slug}`}>View profile</Link>
        {!p.is_sample && p.is_accepting_jobs && (
          <Link className="btn" href={`/book?partner=${p.slug}`}>Book {p.name.split(" ")[0]}</Link>
        )}
      </div>
    </article>
  );
}
