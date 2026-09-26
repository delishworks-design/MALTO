import Link from "next/link";
import { getSiteData, REVALIDATE } from "@/lib/site";

export const revalidate = REVALIDATE;

export async function generateMetadata() {
  const d = await getSiteData();
  return { title: `${d.s("faq_heading")} | MALTO Cleaning Services`, description: d.seo.description };
}

export default async function FAQPage() {
  const d = await getSiteData();
  return <main>
    <header className="header"><div className="container nav">
      <Link href="/" className="logo">MALTO<small>CLEANING SERVICES</small></Link>
      <Link className="btn" href="/book">{d.s("cta_primary")}</Link>
    </div></header>
    <section className="section"><div className="container">
      <div className="eyebrow">FAQ</div>
      <h1>{d.s("faq_heading")}</h1>
      <div className="faq">{d.faq.map((f,i)=><details key={f.q} open={i===0||undefined}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
    </div></section>
  </main>;
}
