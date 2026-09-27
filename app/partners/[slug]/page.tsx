import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteData, REVALIDATE } from "@/lib/site";
import { supabase } from "@/lib/supabase";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { PartnerAvatar, type Partner } from "@/app/partners/page";

export const revalidate = REVALIDATE;

type Rule = { weekday: number; start_time: string; end_time: string };
type TimeOff = { on_date: string; reason: string };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WINDOWS = [
  { label: "Morning", from: 6, to: 12 },
  { label: "Afternoon", from: 12, to: 17 },
  { label: "Evening", from: 17, to: 21 },
];

/** "09:00" -> "9:00 AM", the way people read a time. */
function fmtTime(t: string) {
  const [h, m] = t.split(":");
  const hour = Number(h);
  if (!Number.isFinite(hour)) return t;
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${m} ${suffix}`;
}

/** Which of the three windows this rule actually covers. */
function windowsFor(start: string, end: string) {
  const sH = Number(start.slice(0, 2));
  const eH = Number(end.slice(0, 2)) || sH + 1;
  return WINDOWS.filter((w) => sH < w.to && eH > w.from).map((w) => w.label);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data } = await supabase
    .from("public_partners")
    .select("name,headline,tagline,bio")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return { title: "Partner not found | MALTO Cleaning Services" };
  return {
    title: `${data.name}${data.headline ? ` — ${data.headline}` : ""} | MALTO Cleaning Services`,
    description:
      data.tagline || data.bio?.slice(0, 155) ||
      `${data.name} takes cleaning jobs through MALTO Cleaning Services.`,
  };
}

export default async function PartnerProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await getSiteData();
  const s = d.s;

  const { data: partner, error } = await supabase
    .from("public_partners")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  if (!partner) notFound();

  const p = partner as Partner;

  // A sample must never look bookable, so no slots and no booking link.
  const [rulesRes, offRes] = await Promise.all([
    p.is_sample
      ? Promise.resolve({ data: [] as Rule[] })
      : supabase.from("partner_availability_rules").select("weekday,start_time,end_time").eq("partner_id", p.id),
    p.is_sample
      ? Promise.resolve({ data: [] as TimeOff[] })
      : supabase.from("partner_time_off").select("on_date,reason").eq("partner_id", p.id),
  ]);

  const rules = (rulesRes.data ?? []) as Rule[];
  const timeOff = (offRes.data ?? []) as TimeOff[];
  const byWeekday = new Map<number, Rule[]>();
  for (const r of rules) {
    byWeekday.set(r.weekday, [...(byWeekday.get(r.weekday) ?? []), r]);
  }

  // The view already returns areas qualified with their province, so there is
  // nothing to look up here.
  const areaLabels: string[] = p.area_labels ?? [];

  return <main>
    <SiteHeader />
    <SiteFooter tagline={s("footer_tagline")} />

    <div className="container profile-head">
      <Link className="back-link" href="/partners">← All partners</Link>

      <div className="profile-top">
        <PartnerAvatar partner={p} size={128} />
        <div className="profile-id">
          <div className="eyebrow">MALTO CLEANING PARTNER</div>
          <h1>{p.name}</h1>
          {p.headline && <p className="lead">{p.headline}</p>}
          <div className="pcard-flags">
            {p.is_sample && <span className="badge warn">Sample profile</span>}
            {p.verified && <span className="badge on">Verified</span>}
            {!p.is_accepting_jobs && <span className="badge">Not taking jobs</span>}
            {p.years_experience > 0 && (
              <span className="badge">{p.years_experience} yr{p.years_experience === 1 ? "" : "s"} experience</span>
            )}
          </div>
        </div>
      </div>

      {p.is_sample && (
        <div className="notice sample-notice">
          This is an example profile used while the team is being onboarded. It is not a real cleaner and cannot
          be booked.
        </div>
      )}

      <div className="profile-actions">
        {!p.is_sample && p.is_accepting_jobs ? (
          <Link className="btn" href={`/book?partner=${p.slug}`}>Request this cleaner</Link>
        ) : (
          <span className="small muted">This partner is not taking bookings right now.</span>
        )}
        <Link className="btn secondary" href="/book">Book without choosing</Link>
      </div>
    </div>

    <div className="container profile-body">
      {p.bio && (
        <section className="profile-section">
          <h2>About</h2>
          <p className="prose">{p.bio}</p>
        </section>
      )}

      <section className="profile-section">
        <h2>What they take on</h2>
        {p.specialties?.length ? (
          <ul className="ticks">
            {p.specialties.map((x) => <li key={x}>{x}</li>)}
          </ul>
        ) : (
          <p className="text">Not listed yet.</p>
        )}
      </section>

      <section className="profile-section">
        <h2>Where they work</h2>
        {areaLabels.length ? (
          <ul className="area-list">
            {areaLabels.map((a) => <li key={a}>{a}</li>)}
          </ul>
        ) : (
          <p className="text">Not listed yet.</p>
        )}
      </section>

      {!p.is_sample && (
        <section className="profile-section">
          <h2>Availability</h2>
          {rules.length === 0 ? (
            <p className="text">Hours are being updated. Ask when you book and we will confirm a time.</p>
          ) : (
            <table className="hours">
              <thead><tr><th>Day</th><th>Hours</th><th>Can book</th></tr></thead>
              <tbody>
                {DAYS.map((day, i) => {
                  const dayRules = byWeekday.get(i) ?? [];
                  return (
                    <tr key={day}>
                      <th scope="row">{day}</th>
                      <td>
                        {dayRules.length === 0
                          ? "Not working"
                          : dayRules
                              .map((r) => `${fmtTime(r.start_time)} – ${fmtTime(r.end_time)}`)
                              .join(", ")}
                      </td>
                      <td>
                        {dayRules.length === 0
                          ? "—"
                          : Array.from(
                              new Set(dayRules.flatMap((r) => windowsFor(r.start_time, r.end_time)))
                            ).join(" · ") || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {timeOff.length > 0 && (
            <p className="small muted" style={{ marginTop: "16px" }}>
              Away on {timeOff.map((t) => t.on_date).sort().join(", ")}.
            </p>
          )}
          <p className="small muted" style={{ marginTop: "12px" }}>
            These are the windows this partner is usually available. The exact time is confirmed with you before
            the booking is final.
          </p>
        </section>
      )}

      <section className="profile-section">
        <h2>Track record</h2>
        <div className="facts">
          <div><dt>Jobs completed through MALTO</dt><dd>{p.jobs_completed}</dd></div>
          <div><dt>Experience</dt><dd>{p.years_experience > 0 ? `${p.years_experience} years` : "Not stated"}</dd></div>
        </div>
        <p className="small muted" style={{ marginTop: "14px" }}>
          Ratings appear once this partner has completed jobs and customers have reviewed them.
        </p>
      </section>
    </div>
  </main>;
}
