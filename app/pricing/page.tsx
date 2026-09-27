import Link from "next/link";
import { getSiteData, formatPrice, REVALIDATE } from "@/lib/site";
import { SiteHeader } from "@/components/SiteChrome";

export const revalidate = REVALIDATE;

export async function generateMetadata() {
  const d = await getSiteData();
  return { title: `${d.s("pricing_heading")} | MALTO Cleaning Services`, description: d.s("pricing_disclaimer") || d.seo.description };
}

export default async function Pricing() {
  const d = await getSiteData();
  return <main>
    <SiteHeader ctaLabel={d.s("cta_estimate")} />
    <section className="section"><div className="container">
      <div className="eyebrow">PRICING</div>
      <h1>{d.s("pricing_heading")}</h1>
      <p className="lead">{d.s("pricing_disclaimer")}</p>
      <div className="price-grid" style={{marginTop:40}}>{d.cards.map(x=><div className="price" key={x.label}><span className="small">{x.label}</span><strong>{formatPrice(x.amount,x.suffix)}</strong></div>)}</div>
    </div></section>
  </main>;
}
