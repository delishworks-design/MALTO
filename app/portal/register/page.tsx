"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { SiteHeader } from "@/components/SiteChrome";

/**
 * Partner registration.
 *
 * Two steps because a partner registers from a phone, and the previous
 * one-screen form was already long. The agreement is a separate step that
 * cannot be skipped: the box, the typed name, and the version all have to
 * match what the server currently holds, so a stale page cannot record an
 * acceptance of text that has since changed.
 */

type Terms = { title: string; version: string; intro: string; body: string; hash: string };
type City = { code: string; display_name: string; province_name: string; disambiguated: boolean };
type Service = { id: string; name: string; description: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** "San Jose, Batangas" only when the name is shared; otherwise just the name. */
const cityLabel = (c: City) =>
  c.disambiguated && c.province_name ? `${c.display_name}, ${c.province_name}` : c.display_name;

export default function PartnerRegister() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  // Step 2
  const [headline, setHeadline] = useState("");
  const [tagline, setTagline] = useState("");
  const [bio, setBio] = useState("");
  const [years, setYears] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [cityQuery, setCityQuery] = useState("");
  const [cityPicks, setCityPicks] = useState<City[]>([]);

  // Step 3
  const [terms, setTerms] = useState<Terms | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [readToEnd, setReadToEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [nameTyped, setNameTyped] = useState("");

  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const termsRef = useRef<HTMLDivElement>(null);

  // Reference data. The city list is public, so this needs no admin session.
  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("services").select("id,name,description").eq("active", true).order("sort_order"),
      supabase.from("cities").select("code,display_name,province_name,disambiguated").order("display_name").limit(4000),
    ]).then(([s, c]) => {
      if (s.data) setServices(s.data as Service[]);
      if (c.data) setCities(c.data as City[]);
    });
  }, []);

  const loadTerms = useCallback(async () => {
    const res = await fetch("/api/portal/register");
    const j = await res.json().catch(() => ({} as any));
    if (!res.ok || !j.ok) {
      setTermsError(j.error || "The partner agreement could not be loaded.");
      return;
    }
    setTerms({ title: j.title, version: j.version, intro: j.intro, body: j.body, hash: j.hash });
  }, []);

  useEffect(() => { void loadTerms(); }, [loadTerms]);

  const cityResults = useMemo(() => {
    const q = cityQuery.trim().toLowerCase();
    if (!q) return [];
    return cities
      .filter((c) =>
        c.display_name.toLowerCase().includes(q) || c.province_name.toLowerCase().includes(q)
      )
      .filter((c) => !cityPicks.some((p) => p.code === c.code))
      .slice(0, 8);
  }, [cityQuery, cities, cityPicks]);

  const step1Valid = EMAIL_RE.test(email.trim()) && password.length >= 8 && name.trim().length > 1;
  const step2Valid =
    headline.trim().length > 1 && cityPicks.length > 0 && serviceIds.length > 0;

  const submit = async () => {
    if (busy || !terms) return;
    setBusy(true); setError(null); setField(null);
    try {
      const res = await fetch("/api/portal/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          password,
          headline: headline.trim(),
          tagline: tagline.trim(),
          bio: bio.trim(),
          years_experience: Number(years) || 0,
          service_ids: serviceIds,
          city_codes: cityPicks.map((c) => c.code),
          agreement_accepted: accepted,
          agreement_version: terms.version,
          agreement_hash: terms.hash,
          name_typed: nameTyped.trim(),
        }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (res.status === 409 && j?.version) {
        // The agreement changed underneath them.
        setTermsError(null);
        await loadTerms();
        setReadToEnd(false);
        setAccepted(false);
        throw new Error(j.error);
      }
      if (!res.ok || !j.ok) {
        setField(j.field ?? null);
        throw new Error(j.error || "Could not create your account.");
      }

      // Signed in already, because the account was created confirmed.
      const supabase = createClient();
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInErr) {
        router.push("/portal/login");
        return;
      }

      // The photo goes up now that there is a session, because writing to the
      // bucket requires one. A failed photo is not worth failing registration
      // over, so it is only reported.
      if (photo) {
        const { data: mine } = await supabase
          .from("team_members")
          .select("id")
          .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "")
          .maybeSingle();
        if (mine && photo.size <= 5 * 1024 * 1024) {
          const ext = (photo.name.split(".").pop() || "jpg").toLowerCase();
          const path = `${mine.id}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("team-photos")
            .upload(path, photo, { contentType: photo.type, upsert: true });
          if (!upErr) {
            await supabase.from("team_members").update({ photo_path: path }).eq("id", mine.id);
          }
        }
      }

      router.push("/portal");
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Could not create your account.");
    } finally {
      setBusy(false);
    }
  };

  const goStep2 = () => {
    setError(null);
    if (!name.trim()) { setField("name"); setError("Enter your full name."); return; }
    if (!EMAIL_RE.test(email.trim())) { setField("email"); setError("Enter a valid email address."); return; }
    if (password.length < 8) { setField("password"); setError("Your password needs at least 8 characters."); return; }
    setStep(2);
  };

  return <main className="portal-page">
    <SiteHeader minimal backHref="/" />

    <div className="reg-shell">
      <div className="eyebrow">BECOME A PARTNER</div>
      <h1 className="reg-title">Set up your partner account.</h1>
      <p className="lead">Customers browse the partners listed here, so an honest profile is what gets you booked.</p>

      <ol className="reg-steps" aria-label="Progress">
        {["Your account", "Your profile", "Agreement"].map((label, i) => (
          <li key={label} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""}>
            <span className="reg-step-num">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error && <div className="notice" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>{error}</div>}

      {step === 1 && <div className="form-grid">
        <div className="field full">
          <label>Full name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name"
            placeholder="Ana Reyes" aria-invalid={field === "name"} />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            placeholder="you@gmail.com" aria-invalid={field === "email"} />
        </div>
        <div className="field">
          <label>Mobile number</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel"
            placeholder="09xx xxx xxxx" />
          <span className="small muted">Never shown to customers.</span>
        </div>
        <div className="field full">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password" minLength={8} placeholder="At least 8 characters"
            aria-invalid={field === "password"} />
        </div>
        <div className="field full">
          <button className="btn" onClick={goStep2} disabled={!step1Valid}>CONTINUE</button>
        </div>
      </div>}

      {step === 2 && <>
        <div className="form-grid">
          <div className="field full">
            <label>Headline</label>
            <input value={headline} onChange={(e) => setHeadline(e.target.value)}
              placeholder="Deep cleaning specialist" aria-invalid={field === "headline"} />
            <span className="small muted">A few words customers will see first.</span>
          </div>
          <div className="field full">
            <label>Short tagline</label>
            <input value={tagline} onChange={(e) => setTagline(e.target.value)}
              placeholder="Detail-first deep cleans for lived-in homes." />
          </div>
          <div className="field full">
            <label>About you</label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)}
              placeholder="What you take on, how you work, what a customer can expect." />
          </div>
          <div className="field">
            <label>Years of experience</label>
            <input type="number" min={0} max={70} value={years}
              onChange={(e) => setYears(e.target.value)} placeholder="5" />
          </div>
          <div className="field">
            <label>Photo</label>
            <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            <span className="small muted">A clear photo of your face gets more bookings. Max 5MB.</span>
          </div>

          <div className="field full">
            <label>Services you take</label>
            <div className="choice-row">
              {services.map((s) => (
                <label className="choice-chip" key={s.id}>
                  <input type="checkbox" checked={serviceIds.includes(s.id)}
                    onChange={(e) =>
                      setServiceIds((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))
                    } />
                  {s.name}
                </label>
              ))}
            </div>
            {field === "service_ids" && <span className="small" style={{ color: "var(--danger)" }}>Choose at least one service.</span>}
          </div>

          <div className="field full">
            <label>Where you can work</label>
            <input value={cityQuery} onChange={(e) => setCityQuery(e.target.value)}
              placeholder="Search a city or municipality" autoComplete="off" />
            {cityResults.length > 0 && (
              <ul className="city-results">
                {cityResults.map((c) => (
                  <li key={c.code}>
                    <button type="button" onClick={() => { setCityPicks((p) => [...p, c]); setCityQuery(""); }}>
                      {cityLabel(c)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {cityPicks.length > 0 && (
              <ul className="chips">
                {cityPicks.map((c) => (
                  <li key={c.code} className="chip">
                    {cityLabel(c)}
                    <button type="button" onClick={() => setCityPicks((p) => p.filter((x) => x.code !== c.code))}
                      aria-label={`Remove ${cityLabel(c)}`}>×</button>
                  </li>
                ))}
              </ul>
            )}
            <span className="small muted">
              {cityPicks.length === 0 ? "Add at least one. Customers only see partners who cover where they are." : ""}
            </span>
          </div>
        </div>

        <div className="reg-actions">
          <button className="btn secondary" onClick={() => setStep(1)}>BACK</button>
          <button className="btn" disabled={!step2Valid} onClick={() => { setStep(3); setReadToEnd(false); setAccepted(false); }}>
            CONTINUE TO AGREEMENT
          </button>
        </div>
      </>}

      {step === 3 && <>
        {!terms && !termsError && <p className="text">Loading the agreement…</p>}

        {termsError && <div className="notice" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
          {termsError} <button className="linkbtn" onClick={() => void loadTerms()}>Try again</button>
        </div>}

        {terms && <>
          <div className="agreement">
            <div className="agreement-head">
              <h2>{terms.title}</h2>
              <span className="badge warn">Version {terms.version}</span>
            </div>
            {terms.intro && <div className="notice" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)", border: "1px solid var(--warn-line)" }}>
              {terms.intro}
            </div>}
            <div className="agreement-body" ref={termsRef} onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setReadToEnd(true);
            }} tabIndex={0}>
              {terms.body.split(/\n{2,}/).map((block, i) => {
                const line = block.trim();
                if (line.startsWith("## ")) return <h3 key={i}>{line.slice(3)}</h3>;
                if (line.startsWith("**") && line.includes("** ")) {
                  // Bold lead-in followed by body text, e.g. "**If you book** we hold…"
                  return <p key={i}>{line.replace(/\*\*/g, "")}</p>;
                }
                return <p key={i}>{line}</p>;
              })}
            </div>
            {!readToEnd && <p className="small muted agreement-hint">Scroll to the end of the agreement to continue.</p>}
          </div>

          <div className="agreement-gate">
            <label className="gate-check">
              <input type="checkbox" checked={accepted} disabled={!readToEnd}
                onChange={(e) => setAccepted(e.target.checked)} />
              <span>I have read the partner agreement in full and accept it.</span>
            </label>
            <div className="field">
              <label>Type your full name to confirm</label>
              <input value={nameTyped} onChange={(e) => setNameTyped(e.target.value)} disabled={!accepted}
                placeholder={name} />
              <span className="small muted">Must match “{name}”.</span>
            </div>
          </div>

          <div className="reg-actions">
            <button className="btn secondary" onClick={() => setStep(2)}>BACK</button>
            <button className="btn" disabled={!accepted || nameTyped.trim().toLowerCase() !== name.trim().toLowerCase() || busy}
              onClick={submit}>
              {busy ? "CREATING…" : "CREATE MY ACCOUNT"}
            </button>
          </div>
        </>}
      </>}
    </div>
  </main>;
}
