import Link from "next/link";
import { getSiteData, REVALIDATE } from "@/lib/site";
import { SiteHeader } from "@/components/SiteChrome";

export const revalidate = REVALIDATE;

export async function generateMetadata() {
  const d = await getSiteData();
  return { title: `${d.s("services_heading")} | MALTO Cleaning Services`, description: d.seo.description };
}

export default async function Services() {
  const d = await getSiteData();
  return <main>
    <SiteHeader ctaLabel={d.s("cta_primary")} />
    <section className="section"><div className="container">
      <div className="eyebrow">SERVICES</div>
      <h1>{d.s("services_heading")}</h1>
      <div className="grid4">{d.services.map(x=><div className="card" key={x.name}><h3>{x.name}</h3><p>{x.description}</p></div>)}</div>
    </div></section>
  </main>;
}
