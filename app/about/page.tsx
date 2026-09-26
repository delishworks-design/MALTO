import Link from "next/link";
import { getSiteData, REVALIDATE } from "@/lib/site";

export const revalidate = REVALIDATE;

export async function generateMetadata() {
  const d = await getSiteData();
  return { title: `${d.s("about_title")} | MALTO Cleaning Services`, description: d.s("about_lead") || d.seo.description };
}

export default async function About() {
  const d = await getSiteData();
  return <main>
    <header className="header"><div className="container nav">
      <Link href="/" className="logo">MALTO<small>CLEANING SERVICES</small></Link>
      <Link className="btn" href="/book">{d.s("cta_primary")}</Link>
    </div></header>
    <section className="section"><div className="container">
      <div className="eyebrow">ABOUT MALTO</div>
      <h1>{d.s("about_title")}</h1>
      <p className="lead">{d.s("about_lead")}</p>
    </div></section>
  </main>;
}
