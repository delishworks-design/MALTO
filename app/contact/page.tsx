import Link from "next/link";
import { getSiteData, REVALIDATE } from "@/lib/site";
import { SiteHeader } from "@/components/SiteChrome";

export const revalidate = REVALIDATE;

export async function generateMetadata() {
  const d = await getSiteData();
  return { title: `${d.s("contact_heading")} | MALTO Cleaning Services`, description: d.s("contact_lead") || d.seo.description };
}

const masked = (v: string) => v.replace(/\s+/g, "");

export default async function Contact() {
  const d = await getSiteData();
  const phone = d.s("contact_phone");
  const email = d.s("contact_email");
  const address = d.s("contact_address");
  const hours = d.s("contact_hours");
  const details = [
    phone && { label: "Phone", href: `tel:${masked(phone)}`, text: phone },
    email && { label: "Email", href: `mailto:${email}`, text: email },
    address && { label: "Address", href: "", text: address },
    hours && { label: "Hours", href: "", text: hours },
  ].filter(Boolean) as { label: string; href: string; text: string }[];

  return <main>
    <SiteHeader ctaLabel={d.s("cta_primary")} />
    <section className="section"><div className="container">
      <div className="eyebrow">CONTACT</div>
      <h1>{d.s("contact_heading")}</h1>
      <p className="lead">{d.s("contact_lead")}</p>
      <div className="actions"><Link className="btn" href="/book">{d.s("cta_primary")}</Link></div>
      {details.length>0&&<div className="grid4" style={{marginTop:40}}>
        {details.map(x=><div className="card" key={x.label}>
          <div className="eyebrow">{x.label}</div>
          {x.href?<p><a href={x.href}>{x.text}</a></p>:<p>{x.text}</p>}
        </div>)}
      </div>}
    </div></section>
  </main>;
}
