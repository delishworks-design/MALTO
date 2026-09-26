import Link from "next/link";

const services = [
  ["Home Cleaning","Regular cleaning for apartments, condos and homes."],
  ["Deep Cleaning","For spaces needing extra attention."],
  ["Move-In / Move-Out","Preparing a space for its next chapter."],
  ["Small Business","Cleaning support for offices, shops and studios."]
];
const prices = [
  ["Studio / Room","₱1,300+"],["1BR","₱1,650+"],["2BR","₱2,800+"],["3BR","₱3,400+"],
  ["Small House","₱4,000+"],["Deep Cleaning","₱3,500+"],["Move-In / Move-Out","₱3,500+"],["Small Office","₱2,800+"]
];
export default function Home() {
 return <main>
  <header className="header"><div className="container nav">
   <Link href="/" className="logo">MALTO<small>CLEANING SERVICES</small></Link>
   <nav className="navlinks"><a href="#services">Services</a><a href="#pricing">Pricing</a><a href="#how">How It Works</a><a href="#about">About</a><a href="#faq">FAQ</a></nav>
   <Link className="btn" href="/book">BOOK A CLEANING</Link>
  </div></header>
  <section className="hero"><div className="container hero-grid"><div><div className="eyebrow">MALTO CLEANING SERVICES</div><h1>A Better Standard of Clean.</h1><p className="lead">Reliable cleaning services for homes and small businesses.</p><div className="actions"><Link className="btn" href="/book">BOOK A CLEANING</Link><a className="btn secondary" href="#services">VIEW SERVICES</a></div></div><div className="hero-note">Quietly premium. Locally focused. Thoughtful about the work and transparent about the service.</div></div></section>
  <section className="section" id="services"><div className="container"><div className="section-head"><h2>Services</h2><p>Practical cleaning services designed around your space, its condition and the scope of work required.</p></div><div className="grid4">{services.map(([t,p])=><article className="card" key={t}><h3>{t}</h3><p>{p}</p></article>)}</div></div></section>
  <section className="section" id="pricing"><div className="container"><div className="section-head"><h2>Pricing</h2><p>Cleaning services starting from ₱1,300+. Final pricing depends on size, condition, scope, number of cleaners, location and materials.</p></div><div className="price-grid">{prices.map(([n,p])=><div className="price" key={n}><span className="small">{n}</span><strong>{p}</strong></div>)}</div><div className="actions"><Link className="btn" href="/book">GET AN ESTIMATE</Link></div></div></section>
  <section className="section" id="about"><div className="container"><div className="section-head"><h2>Small Team. Serious About the Work.</h2><p>We focus on careful service, transparent pricing, flexible cleaning options and professional presentation.</p></div><div className="grid4">{["Careful","Transparent","Flexible","Local"].map(x=><div className="card" key={x}><h3>{x}</h3></div>)}</div></div></section>
  <section className="section" id="how"><div className="container"><div className="section-head"><h2>How It Works</h2><p>Your request is reviewed before a final price and schedule are confirmed.</p></div><div className="steps">{["Tell us about your space","We review your request","Receive your final quote","We get to work"].map((x,i)=><div className="step" key={x}><div className="step-num">0{i+1}</div><h3>{x}</h3></div>)}</div></div></section>
  <section className="section" id="faq"><div className="container"><div className="section-head"><h2>FAQ</h2></div><div className="faq">
   <details><summary>Do I need to provide cleaning supplies?</summary><p>You may provide materials, or MALTO can provide them for an additional fee.</p></details>
   <details><summary>What if my home is very dirty?</summary><p>Please indicate the condition during booking so MALTO can estimate the appropriate scope, time and number of cleaners.</p></details>
   <details><summary>Do you offer same-day availability?</summary><p>Subject to availability.</p></details>
   <details><summary>Is the price shown on the website final?</summary><p>No. The website provides starting prices and estimates. Final pricing is confirmed after MALTO reviews the request.</p></details>
  </div></div></section>
  <section className="section"><div className="container"><h2>Ready for a better standard of clean?</h2><Link className="btn" href="/book">BOOK A CLEANING</Link></div></section>
  <footer className="footer"><div className="container footer-grid"><div className="logo">MALTO<small>CLEANING SERVICES</small></div><div className="small">A Better Standard of Clean.</div></div></footer>
 </main>
}