import type { Metadata } from "next";
import { getSiteData, REVALIDATE } from "@/lib/site";
import { supabase } from "@/lib/supabase";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { renderMarkdown } from "@/lib/markdown";

export const revalidate = REVALIDATE;

export const metadata: Metadata = {
  title: "Terms of Service | MALTO Cleaning Services",
  description:
    "How bookings, quotes, scheduling, cancellations and payments work when you book a cleaning through MALTO.",
  alternates: { canonical: "/terms" },
};

export default async function TermsPage() {
  const d = await getSiteData();
  const s = d.s;

  const { data } = await supabase
    .from("site_settings")
    .select("key,value")
    .in("key", ["terms_body", "terms_updated"]);

  const rows = data ?? [];
  const body = rows.find((r) => r.key === "terms_body")?.value ?? "";
  const updated = rows.find((r) => r.key === "terms_updated")?.value ?? "";

  return <main>
    <SiteHeader />
    <SiteFooter tagline={s("footer_tagline")} />

    <div className="container page-head">
      <div className="eyebrow">LEGAL</div>
      <h1>Terms of Service</h1>
      <p className="lead">
        The agreement between you and MALTO when you book a cleaning.
      </p>
      {updated && <p className="small muted">Last updated {updated}</p>}
    </div>

    <div className="container legal-body">
      {body
        ? renderMarkdown(body)
        : <div className="empty-state">
            <h2>These terms have not been written yet.</h2>
            <p>They can be added from Settings in the admin area.</p>
          </div>}
    </div>
  </main>;
}
