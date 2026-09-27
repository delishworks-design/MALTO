import type { Metadata } from "next";
import { getSiteData, REVALIDATE } from "@/lib/site";
import { supabase } from "@/lib/supabase";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import { renderMarkdown } from "@/lib/markdown";

export const revalidate = REVALIDATE;

export const metadata: Metadata = {
  title: "Privacy Policy | MALTO Cleaning Services",
  description:
    "What MALTO Cleaning Services collects when you book a cleaning or join as a partner, who it is shared with, and how long it is kept.",
  alternates: { canonical: "/privacy" },
};

export default async function PrivacyPage() {
  const d = await getSiteData();
  const s = d.s;

  // Read as a plain key/value lookup so the admin can rewrite the policy in
  // Settings without a deploy.
  const { data } = await supabase
    .from("site_settings")
    .select("key,value")
    .in("key", ["privacy_policy_body", "privacy_policy_updated"]);

  const rows = data ?? [];
  const body = rows.find((r) => r.key === "privacy_policy_body")?.value ?? "";
  const updated = rows.find((r) => r.key === "privacy_policy_updated")?.value ?? "";

  return <main>
    <SiteHeader />
    <SiteFooter tagline={s("footer_tagline")} />

    <div className="container page-head">
      <div className="eyebrow">LEGAL</div>
      <h1>Privacy Policy</h1>
      <p className="lead">
        What we hold about you, why we hold it, and what we do with it.
      </p>
      {updated && <p className="small muted">Last updated {updated}</p>}
    </div>

    <div className="container legal-body">
      {body
        ? renderMarkdown(body)
        : <div className="empty-state">
            <h2>This policy has not been written yet.</h2>
            <p>It can be added from Settings in the admin area.</p>
          </div>}
    </div>
  </main>;
}
