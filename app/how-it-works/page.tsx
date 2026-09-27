import { SiteHeader } from "@/components/SiteChrome";

export default function How() {
  return <main>
    <SiteHeader />
    <section className="section"><div className="container">
      <div className="eyebrow">HOW IT WORKS</div>
      <h1>A request, reviewed with care.</h1>
      <div className="steps">
        {["Tell us about your space", "We review your request", "Receive your final quote", "We get to work"].map((x, i) => (
          <div className="step" key={x}>
            <div className="step-num">0{i + 1}</div>
            <h3>{x}</h3>
          </div>
        ))}
      </div>
    </div></section>
  </main>;
}
