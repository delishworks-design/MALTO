import Link from "next/link";
import { getSiteData, formatPrice, REVALIDATE } from "@/lib/site";

export const revalidate = REVALIDATE;

export async function generateMetadata() {
  const d = await getSiteData();
  return { title: d.seo.title, description: d.seo.description };
}

export default async function Home() {
  const d = await getSiteData();
  const s = d.s;
  return <main>
  <header className="header"><div className="container nav">
   <Link href="/" className="logo">MALTO<small>CLEANING SERVICES</small></Link>
   <nav className="navlinks"><a href="#services">Services</a><a href="#pricing">Pricing</a><a href="#how">How It Works</a><a href="#about">About</a><a href="#faq">FAQ</a></nav>
   <Link className="btn" href="/book">{s("cta_primary")}</Link>
  </div></header>
  <section className="hero"><div className="container hero-grid"><div><div className="eyebrow">MALTO CLEANING SERVICES</div><h1>{s("hero_headline")}</h1><p className="lead">{s("hero_lead")}</p><div className="actions"><Link className="btn" href="/book">{s("cta_primary")}</Link><a className="btn secondary" href="#services">{s("cta_secondary")}</a></div></div><div className="hero-note">{s("hero_note")}</div></div></section>
  <section className="section" id="services"><div className="container"><div className="section-head"><h2>Services</h2><p>{s("services_lead")}</p></div><div className="grid4">{d.services.map(x=><article className="card" key={x.name}><h3>{x.name}</h3><p>{x.description}</p></article>)}</div></div></section>
  <section className="section" id="pricing"><div className="container"><div className="section-head"><h2>Pricing</h2><p>{s("pricing_lead")}</p></div><div className="price-grid">{d.cards.map(x=><div className="price" key={x.label}><span className="small">{x.label}</span><strong>{formatPrice(x.amount,x.suffix)}</strong></div>)}</div><div className="actions"><Link className="btn" href="/book">{s("cta_estimate")}</Link></div></div></section>
  <section className="section" id="about"><div className="container"><div className="section-head"><h2>{s("about_title")}</h2><p>{s("about_body")}</p></div><div className="grid4">{["Careful","Transparent","Flexible","Local"].map(x=><div className="card" key={x}><h3>{x}</h3></div>)}</div></div></section>
  <section className="section" id="how"><div className="container"><div className="section-head"><h2>How It Works</h2><p>Your request is reviewed before a final price and schedule are confirmed.</p></div><div className="steps">{["Tell us about your space","We review your request","Receive your final quote","We get to work"].map((x,i)=><div className="step" key={x}><div className="step-num">0{i+1}</div><h3>{x}</h3></div>)}</div></div></section>
  <section className="section" id="faq"><div className="container"><div className="section-head"><h2>FAQ</h2></div><div className="faq">
   {d.faq.map(f=><details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
  </div></div></section>
  <section className="section"><div className="container"><h2>Ready for a better standard of clean?</h2><Link className="btn" href="/book">{s("cta_primary")}</Link></div></section>
  <footer className="footer"><div className="container footer-grid"><div className="logo">MALTO<small>CLEANING SERVICES</small></div><div className="small">{s("footer_tagline")}</div></div></footer>
 </main>
}
