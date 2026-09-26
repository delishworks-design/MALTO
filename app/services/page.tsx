import Link from "next/link";
import { getSiteData, REVALIDATE } from "@/lib/site";

export const revalidate = REVALIDATE;

export async function generateMetadata() {
  const d = await getSiteData();
  return { title: `${d.s("services_heading")} | MALTO Cleaning Services`, description: d.seo.description };
}

export default async function Services() {
  const d = await getSiteData();
  return <main>
    <header className="header"><div className="container nav">
      <Link href="/" className="logo">MALTO<small>CLEANING SERVICES</small></Link>
      <Link className="btn" href="/book">{d.s("cta_primary")}</Link>
    </div></header>
    <section className="section"><div className="container">
      <div className="eyebrow">SERVICES</div>
      <h1>{d.s("services_heading")}</h1>
      <div className="grid4">{d.services.map(x=><div className="card" key={x.name}><h3>{x.name}</h3><p>{x.description}</p></div>)}</div>
    </div></section>
  </main>;
}
