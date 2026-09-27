import type { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase";
import { formatPrice } from "@/lib/site";

/**
 * The sitemap is built from live data rather than a hand-kept list, so a
 * partner who joins tomorrow is discoverable without anyone remembering to add
 * them, and a partner who is taken off the marketplace stops being advertised
 * instead of lingering as a dead link.
 *
 * The base URL comes from the environment rather than being written down, so a
 * preview deployment does not tell Google to index itself under production.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://malto-cleaning-services.vercel.app")
    .replace(/\/+$/, "");

  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/book`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/partners`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/services`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/how-it-works`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/about`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    // How partners join, not a page for customers to read.
    { url: `${base}/portal/register`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];

  let partnerRoutes: MetadataRoute.Sitemap = [];
  try {
    const { data } = await supabase
      .from("public_partners")
      .select("slug,created_at")
      .not("slug", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000);
    partnerRoutes = (data ?? []).map((p) => ({
      url: `${base}/partners/${p.slug}`,
      lastModified: p.created_at ? new Date(p.created_at) : now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
  } catch {
    // A sitemap that omits partner profiles is still a valid sitemap, so a
    // database blip must not take the whole route down with it.
  }

  return [...staticRoutes, ...partnerRoutes];
}
