import { supabase } from "@/lib/supabase";

/** Public pages are regenerated at most once a minute. */
export const REVALIDATE = 60;

export type FaqItem = { q: string; a: string };
export type ServiceRow = { name: string; description: string };
export type PriceCard = { label: string; amount: number; suffix: string };

/**
 * Fallbacks = the exact copy that was hardcoded before the site went
 * database-driven, so the public site never renders empty if Supabase is
 * unreachable or the tables are missing.
 */
const DEFAULTS: Record<string, string> = {
  hero_headline: "A Better Standard of Clean.",
  hero_lead: "Reliable cleaning services for homes and small businesses.",
  hero_note:
    "Quietly premium. Locally focused. Thoughtful about the work and transparent about the service.",
  footer_tagline: "A Better Standard of Clean.",
  cta_primary: "BOOK A CLEANING",
  cta_secondary: "VIEW SERVICES",
  cta_estimate: "GET AN ESTIMATE",
  services_heading: "Cleaning, thoughtfully scoped.",
  services_lead:
    "Practical cleaning services designed around your space, its condition and the scope of work required.",
  pricing_heading: "Starting prices.",
  pricing_lead:
    "Cleaning services starting from ₱1,300+. Final pricing depends on size, condition, scope, number of cleaners, location and materials.",
  pricing_starting_from: "₱1,300+",
  pricing_disclaimer:
    "Final pricing depends on property size, condition, cleaning scope, number of cleaners, estimated hours, location and materials.",
  about_title: "Small Team. Serious About the Work.",
  about_body:
    "We focus on careful service, transparent pricing, flexible cleaning options and professional presentation.",
  about_lead:
    "MALTO is a local cleaning service focused on reliable service, careful work, transparent pricing and professional presentation.",
  contact_heading: "Tell us about your space.",
  contact_lead:
    "For cleaning requests, use the booking form so MALTO can review the scope, location, availability and pricing.",
  contact_phone: "",
  contact_email: "",
  contact_address: "",
  contact_hours: "",
  faq_heading: "Frequently asked questions.",
  seo_title: "MALTO Cleaning Services | A Better Standard of Clean.",
  seo_description:
    "Reliable cleaning services for homes and small businesses. Home cleaning, deep cleaning and move-in / move-out with transparent pricing.",
};

const DEFAULT_SERVICES: ServiceRow[] = [
  { name: "Home Cleaning", description: "Regular cleaning for apartments, condos and homes." },
  { name: "Deep Cleaning", description: "For spaces needing extra attention." },
  { name: "Move-In / Move-Out", description: "Preparing a space for its next chapter." },
  { name: "Small Business", description: "Cleaning support for offices, shops and studios." },
];

const DEFAULT_CARDS: PriceCard[] = [
  { label: "Studio / Room", amount: 1300, suffix: "+" },
  { label: "1BR", amount: 1650, suffix: "+" },
  { label: "2BR", amount: 2800, suffix: "+" },
  { label: "3BR", amount: 3400, suffix: "+" },
  { label: "Small House", amount: 4000, suffix: "+" },
  { label: "Deep Cleaning", amount: 3500, suffix: "+" },
  { label: "Move-In / Move-Out", amount: 3500, suffix: "+" },
  { label: "Small Office", amount: 2800, suffix: "+" },
];

const DEFAULT_FAQ: FaqItem[] = [
  { q: "Do I need to provide cleaning supplies?", a: "You may provide materials, or MALTO can provide them for an additional fee." },
  { q: "What if my home is very dirty?", a: "Please indicate the condition during booking so MALTO can estimate the appropriate scope, time and number of cleaners." },
  { q: "Do you offer same-day availability?", a: "Subject to availability." },
  { q: "Is the price shown on the website final?", a: "No. The website provides starting prices and estimates. Final pricing is confirmed after MALTO reviews the request." },
];

export type SiteData = {
  /** Read a configured string; falls back to the original hardcoded copy. */
  s: (key: string) => string;
  services: ServiceRow[];
  cards: PriceCard[];
  faq: FaqItem[];
  seo: { title: string; description: string };
};

export const formatPrice = (amount: number, suffix = "") =>
  `₱${Number(amount).toLocaleString("en-PH")}${suffix}`;

function build(overrides: Record<string, string>, services: ServiceRow[], cards: PriceCard[], faq: FaqItem[]): SiteData {
  const map: Record<string, string> = { ...DEFAULTS, ...overrides };
  return {
    s: (key: string) => map[key] ?? "",
    services,
    cards,
    faq,
    seo: { title: map.seo_title, description: map.seo_description },
  };
}

export async function getSiteData(): Promise<SiteData> {
  try {
    const [settingsRes, servicesRes, cardsRes] = await Promise.all([
      supabase.from("site_settings").select("key,value"),
      supabase.from("services").select("name,description,active,sort_order").order("sort_order"),
      supabase.from("price_cards").select("label,amount,suffix,active,sort_order").order("sort_order"),
    ]);

    const overrides: Record<string, string> = {};
    for (const row of settingsRes.data ?? []) {
      if (row.key && typeof row.value === "string") overrides[row.key] = row.value;
    }

    const services: ServiceRow[] = (servicesRes.data ?? [])
      .filter((r) => r.active !== false && r.name)
      .map((r) => ({ name: r.name, description: r.description ?? "" }));

    const cards: PriceCard[] = (cardsRes.data ?? [])
      .filter((r) => r.active !== false && r.label)
      .map((r) => ({ label: r.label, amount: Number(r.amount) || 0, suffix: r.suffix ?? "" }));

    let faq: FaqItem[] = DEFAULT_FAQ;
    if (overrides.faq_items) {
      try {
        const parsed = JSON.parse(overrides.faq_items);
        if (Array.isArray(parsed) && parsed.length) {
          faq = parsed
            .filter((x: any) => x && (x.q || x.a))
            .map((x: any) => ({ q: String(x.q ?? ""), a: String(x.a ?? "") }));
        }
      } catch {
        /* keep defaults */
      }
    }

    return build(overrides, services.length ? services : DEFAULT_SERVICES, cards.length ? cards : DEFAULT_CARDS, faq);
  } catch {
    return build({}, DEFAULT_SERVICES, DEFAULT_CARDS, DEFAULT_FAQ);
  }
}
