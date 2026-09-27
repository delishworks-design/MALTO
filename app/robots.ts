import type { MetadataRoute } from "next";

/**
 * The booking form, the partner portal and the whole admin area are not for
 * search engines. The portal pages in particular hold an account behind them,
 * and a crawler following a link into a login page is noise at best.
 *
 * Disallow is a hint, not a lock: the actual protection is the route guard and
 * the row level security behind every query. This just keeps the results clean
 * and keeps credentials out of crawl logs.
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://malto-cleaning-services.vercel.app")
    .replace(/\/+$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/portal",
          "/api/",
          "/book",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
