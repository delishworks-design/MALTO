"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { SiteHeader } from "@/components/SiteChrome";

const steps = ["Service","Property","Scope","Materials","Location","Cleaner","Schedule","Customer","Review"];
const LAST = steps.length - 1;
const DEFAULT_SERVICE_OPTIONS = ["Home Cleaning","Deep Cleaning","Move-In / Move-Out","Small Business"];
const propertyOptions = ["Condo","Apartment","House","Office","Shop/Studio","Other"];
const areas = ["Living room","Bedrooms","Kitchen","Bathrooms","Floors","Windows","Balcony","Appliances","Other"];
const windows = ["Morning","Afternoon","Evening"];

const PHOTO_BUCKET = "booking-photos";
const MAX_PHOTO_BYTES = 5*1024*1024;
const ALLOWED_PHOTO_TYPES = ["image/jpeg","image/png","image/webp","image/gif","image/heic","image/heif"];
const MAX_REF_ATTEMPTS = 3;
const DRAFT_KEY = "malto-booking-draft-v2";

const pad = (n: number) => String(n).padStart(2,"0");

/** MAL-YYYYMMDD-HHMM in Asia/Manila time (UTC+8). */
function makeBookingRef(at = new Date()) {
  const m = new Date(at.getTime() + 8*60*60*1000);
  return `MAL-${m.getUTCFullYear()}${pad(m.getUTCMonth()+1)}${pad(m.getUTCDate())}-${pad(m.getUTCHours())}${pad(m.getUTCMinutes())}`;
}

/** Today's date in Manila as yyyy-mm-dd, which is what <input type=date> wants.
 *  The browser's own clock is not used: a customer in California booking a
 *  Manila cleaner is told the wrong cutoff otherwise. */
function manilaToday() {
  const m = new Date(Date.now() + 8*60*60*1000);
  return `${m.getUTCFullYear()}-${pad(m.getUTCMonth()+1)}-${pad(m.getUTCDate())}`;
}

/** An instant is only bookable if it is at least a couple of hours out, so a
 *  slot cannot vanish between the customer picking it and pressing submit. */
function earliestBookableDate() {
  const m = new Date(Date.now() + 8*60*60*1000 + 24*60*60*1000);
  return `${m.getUTCFullYear()}-${pad(m.getUTCMonth()+1)}-${pad(m.getUTCDate())}`;
}

type Frequency = "once"|"weekly"|"biweekly"|"monthly";
type Plan = { frequency: Frequency; label: string; clientLabel: string; discountPct: number };
type City = { code: string; display_name: string; province_name: string; disambiguated: boolean };
type PartnerOpt = {
  id: string; slug: string; name: string; headline: string; tagline: string;
  photo_path: string; verified: boolean; years_experience: number;
  specialties: string[] | null; areas: string[] | null; area_codes: string[] | null;
};

/** The starting price is a display string like "₱1,300+", so the discount has
 *  to be applied to the number inside it. Anything unparseable is shown as-is
 *  rather than replaced with a wrong figure. */
function discountPriceText(text: string, pct: number) {
  if (!pct) return text;
  const match = String(text).match(/[0-9][0-9,]*/);
  if (!match) return text;
  const base = Number(match[0].replace(/,/g,""));
  if (!Number.isFinite(base) || base <= 0) return text;
  return `₱${(Math.ceil((base*(1-pct/100))/50)*50).toLocaleString("en-PH")}+`;
}

function randomSuffix() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random()*chars.length)]).join("");
}

function friendlyError(error: any) {
  const code = error?.code;
  const msg = String(error?.message || "");
  if (code === "23505") return null;
  if (code === "42501" || /permission denied/i.test(msg))
    return "Bookings are not accepting submissions yet — the database permissions (RLS) still need to be configured.";
  if (code === "42P01" || /does not exist/i.test(msg))
    return "The booking tables are not set up yet. Please run the migration SQL in the Supabase SQL Editor.";
  if (/Failed to fetch|NetworkError|fetch failed/i.test(msg))
    return "Could not reach the booking service. Please check your connection and try again.";
  return msg || "Something went wrong while saving your booking. Please try again.";
}

// --- validation ------------------------------------------------------------

/** Philippine mobile: 09XX XXX XXXX, tolerating the spaces and dashes people
 *  actually type, and rejecting the nine-digit form that has no prefix. */
function phoneError(v: string) {
  const raw = String(v || "").trim();
  if (!raw) return "Please enter your mobile number.";
  const digits = raw.replace(/[\s\-()]/g, "");
  if (!/^09\d{9}$/.test(digits))
    return "Enter a Philippine mobile number, like 0917 123 4567.";
  return null;
}

function emailError(v: string) {
  const raw = String(v || "").trim();
  if (!raw) return "Please enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(raw))
    return "That email address does not look right. Check for a typo.";
  return null;
}

function nameError(v: string) {
  if (!String(v || "").trim()) return "Please enter your full name.";
  if (String(v).trim().length < 2) return "Please enter your full name.";
  return null;
}

const fmtDate = (d: string) => {
  if (!d) return "";
  const t = new Date(`${d}T00:00:00+08:00`);
  if (Number.isNaN(t.getTime())) return d;
  return t.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
};

export default function Book() {
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [bookingRef, setBookingRef] = useState("");
  const [restored, setRestored] = useState(false);
  const [data, setData] = useState<Record<string, any>>({
    service: "", property: "", areas: [], condition: "Normal",
    materials: "Customer provides materials", time: "Morning", photo: null,
  });
  const [serviceOptions, setServiceOptions] = useState<string[]>(DEFAULT_SERVICE_OPTIONS);
  const [startingPrice, setStartingPrice] = useState("₱1,300+");
  const [deepPrice, setDeepPrice] = useState("₱3,500+");
  const [plans, setPlans] = useState<Plan[]>([
    { frequency: "once", label: "One-time", clientLabel: "", discountPct: 0 },
    { frequency: "weekly", label: "Weekly", clientLabel: "Every week", discountPct: 10 },
    { frequency: "biweekly", label: "Twice a week", clientLabel: "Twice a week", discountPct: 15 },
    { frequency: "monthly", label: "Monthly", clientLabel: "Once a month", discountPct: 5 },
  ]);

  // Cleaner step
  const [partners, setPartners] = useState<PartnerOpt[]>([]);
  const [cityQuery, setCityQuery] = useState("");
  const [cities, setCities] = useState<City[]>([]);
  // Schedule step
  const [slots, setSlots] = useState<{ starts_at: string; label: string }[]>([]);
  const [slotsFailed, setSlotsFailed] = useState(false);
  const [slotsFor, setSlotsFor] = useState<string>("");
  const [slotsBusy, setSlotsBusy] = useState(false);
  const hydrated = useRef(false);

  const recurringOnly = plans.filter(p => p.frequency !== "once");
  const set = (k: string, v: any) => setData(d => ({ ...d, [k]: v }));
  const toggleArea = (a: string) =>
    set("areas", (data.areas||[]).includes(a) ? data.areas.filter((x: string) => x !== a) : [...(data.areas||[]), a]);

  const chosenPlan = plans.find(p => p.frequency === (data.frequency || "once")) || plans[0];
  const discountPct = chosenPlan ? chosenPlan.discountPct : 0;

  const estimate = useMemo(() => {
    const base = data.service === "Deep Cleaning" ? deepPrice : startingPrice;
    return {
      cleaners: data.property === "House" || data.property === "Office" ? 2 : 1,
      hours: data.service === "Deep Cleaning" ? 6 : 5,
      price: discountPriceText(base, discountPct),
      basePrice: base,
      discountPct,
    };
  }, [data, deepPrice, startingPrice, discountPct]);

  // --- reference data
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [svc,cards,settings,disc,parts] = await Promise.all([
          supabase.from("services").select("name,active,sort_order").order("sort_order"),
          supabase.from("price_cards").select("label,amount,suffix").eq("label","Deep Cleaning").maybeSingle(),
          supabase.from("site_settings").select("key,value").eq("key","pricing_starting_from").maybeSingle(),
          supabase.from("recurring_discounts").select("frequency,label,client_label,discount_pct,sort_order").order("sort_order"),
          supabase.from("public_partners")
            .select("id,slug,name,headline,tagline,photo_path,verified,years_experience,specialties,areas,area_codes")
            .eq("is_accepting_jobs", true).eq("is_sample", false).order("name"),
        ]);
        if (!alive) return;
        const names = (svc.data||[]).filter((r: any) => r.active !== false && r.name).map((r: any) => r.name);
        if (names.length) setServiceOptions(names);
        if (cards.data) setDeepPrice(`₱${Number(cards.data.amount||0).toLocaleString("en-PH")}${cards.data.suffix||""}`);
        if (settings.data?.value) setStartingPrice(String(settings.data.value));
        const rows = (disc.data||[]).filter((r: any) => r && r.frequency).map((r: any) => ({
          frequency: r.frequency as Frequency, label: String(r.label ?? ""),
          clientLabel: String(r.client_label ?? ""), discountPct: Number(r.discount_pct) || 0,
        }));
        if (rows.length) setPlans(rows);
        setPartners((parts.data ?? []) as PartnerOpt[]);
      } catch { /* keep hardcoded defaults */ }
    })();
    return () => { alive = false; };
  }, []);

  // --- draft
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          // The photo is a File and cannot be restored, so it is never stored.
          setData(d => ({ ...d, ...parsed, photo: null }));
          setRestored(true);
        }
      }
    } catch { /* a corrupt draft is not worth reporting */ }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current || submitted) return;
    const { photo, ...rest } = data;
    void photo;
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(rest)); } catch { /* private mode */ }
  }, [data, submitted]);

  // --- cities, fetched only once the location step is actually open
  useEffect(() => {
    if (step !== 4 || cities.length) return;
    let alive = true;
    (async () => {
      const { data: rows } = await supabase
        .from("cities").select("code,display_name,province_name,disambiguated")
        .order("display_name").limit(4000);
      if (alive) setCities(rows ?? []);
    })();
    return () => { alive = false; };
  }, [step, cities.length]);

  const cityMatches = useMemo(() => {
    const q = cityQuery.trim().toLowerCase();
    if (!q || !cities.length) return [];
    return cities
      .filter(c => c.display_name.toLowerCase().includes(q) || (c.province_name||"").toLowerCase().includes(q))
      .slice(0, 8);
  }, [cityQuery, cities]);

  const cityLabel = (c: City) =>
    c.disambiguated && c.province_name ? `${c.display_name}, ${c.province_name}` : c.display_name;

  const pickCity = (c: City) => {
    setData(d => ({ ...d, city: c.display_name, city_label: cityLabel(c), city_code: c.code, province: c.province_name || "" }));
    setCityQuery("");
  };

  // --- partners that actually cover the chosen city
  const eligiblePartners = useMemo(() => {
    const code = data.city_code as string | undefined;
    return partners.filter(p => {
      if (code && Array.isArray(p.area_codes) && p.area_codes.length) return p.area_codes.includes(code);
      return true;
    });
  }, [partners, data.city_code]);

  const chosenPartner = useMemo(
    () => partners.find(p => p.id === (data.partner_id as string)) || null,
    [partners, data.partner_id],
  );

  // --- real slots for the chosen partner on the chosen day
  useEffect(() => {
    const pid = data.partner_id as string | undefined;
    const date = data.date as string | undefined;
    const win = data.time as string | undefined;
    if (!pid || !date) { setSlots([]); setSlotsFor(""); return; }
    const key = `${pid}|${date}|${win}`;
    if (slotsFor === key) return;
    setSlotsBusy(true);
    let alive = true;
    (async () => {
      const { data: rows, error: rpcErr } = await supabase.rpc("partner_slots", {
        p_partner_id: pid, p_on_date: date, p_window: win, p_minutes: 30,
      });
      if (!alive) return;
      setSlotsFailed(!!rpcErr);
      setSlots((rows ?? []) as { starts_at: string; label: string }[]);
      setSlotsFor(key);
      setSlotsBusy(false);
    })();
    return () => { alive = false; };
  }, [data.partner_id, data.date, data.time, slotsFor]);

  // A slot belongs to a specific day and window, so changing any of them
  // clears it rather than quietly booking the previous time. Keyed on the
  // combination and compared against the last one, because a plain effect on
  // those fields also runs on mount and would throw away a restored draft.
  const slotKey = `${data.partner_id || ""}|${data.date || ""}|${data.time || ""}`;
  const prevSlotKey = useRef(slotKey);
  useEffect(() => {
    if (prevSlotKey.current === slotKey) return;
    prevSlotKey.current = slotKey;
    if (data.starts_at) setData(d => ({ ...d, starts_at: null, slot_label: "" }));  // eslint-disable-line react-hooks/exhaustive-deps
  }, [slotKey]);

  // --- per-step validation, so CONTINUE cannot walk past an empty step
  const stepError = (s: number): string | null => {
    switch (s) {
      case 0: return data.service ? null : "Please choose a service to continue.";
      case 1: return data.property ? null : "Please select a property type to continue.";
      case 4:
        if (!String(data.address || "").trim()) return "Please enter the service address to continue.";
        if (!String(data.city || "").trim()) return "Please choose your city from the list to continue.";
        return null;
      case 6: {
        if (!data.date) return "Please choose a preferred date to continue.";
        if (data.date < manilaToday()) return "Please choose a date that is not in the past.";
        // Same day is only offered when a cleaner is named, because their live
        // slots prove someone is genuinely free. Without a name we have nothing
        // to check against, so we ask for a day's notice rather than promise a
        // morning that may already be gone.
        if (!data.partner_id && data.date < earliestBookableDate())
          return "Without a chosen cleaner we need at least a day's notice to arrange someone. Please pick tomorrow or later, or choose a cleaner.";
        if (data.partner_id && !data.starts_at)
          return "Please pick a start time, or go back and choose no preference.";
        return null;
      }
      case 7:
        return nameError(data.name) || phoneError(data.mobile) || emailError(data.email);
      default: return null;
    }
  };

  const next = () => {
    const problem = stepError(step);
    if (problem) { setError(problem); return; }
    setError(null);
    setStep(s => Math.min(LAST, s + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const back = () => { setError(null); setStep(s => Math.max(0, s - 1)); };
  const goTo = (s: number) => { setError(null); setStep(s); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const onPhoto = (file: File | null) => {
    if (!file) { set("photo", null); setError(null); return; }
    if (file.size > MAX_PHOTO_BYTES) { set("photo", null); setError("That photo is larger than 5MB. Please choose a smaller image."); return; }
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) { set("photo", null); setError("Please upload an image file (JPG, PNG, WEBP, GIF or HEIC)."); return; }
    setError(null);
    set("photo", file);
  };

  const uploadPhoto = async (ref: string, file: File) => {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g,"") || "jpg";
    const path = `${ref}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw upErr;
    return path;
  };

  const submitBooking = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setPhotoNote(null);
    try {
      for (let s = 0; s < LAST; s++) {
        const problem = stepError(s);
        if (problem) throw new Error(problem);
      }

      const photo = data.photo as File | null;
      const baseRef = makeBookingRef();
      let lastError: any = null;
      let photoFailed = false;

      for (let attempt = 0; attempt < MAX_REF_ATTEMPTS; attempt++) {
        const ref = attempt === 0 ? baseRef : `${baseRef}-${randomSuffix()}`;
        let photoPath: string | null = null;

        if (photo) {
          try { photoPath = await uploadPhoto(ref, photo); }
          catch { photoPath = null; photoFailed = true; }
        }

        // Text columns are sent as "" (never null) so a NOT NULL constraint
        // without a default still passes. Numeric/date columns are omitted
        // when empty so the database default applies instead of null.
        const payload: Record<string, any> = {
          booking_ref: ref,
          services: data.service,
          property: data.property || "",
          sqm: data.sqm ? String(data.sqm) : "",
          areas: Array.isArray(data.areas) ? data.areas.join(", ") : "",
          condition: data.condition || "",
          scope_notes: data.scopeNotes || "",
          materials: data.materials || "",
          adress: data.address || "",
          city: data.city || "",
          city_code: data.city_code || "",
          province: data.province || "",
          landmark: data.landmark || "",
          access: data.access || "",
          time: data.time || "",
          names: data.name || "",
          phone: data.mobile || "",
          email: data.email || "",
          notes: data.notes || "",
          status: "New Request",
          frequency: chosenPlan ? chosenPlan.frequency : "once",
          // Left null when the customer did not choose anyone: MALTO assigns the
          // best available partner, and a null partner_id is what tells the
          // admin queue to do it.
          partner_id: data.partner_id || null,
        };
        if (data.starts_at) payload.starts_at = data.starts_at;
        if (data.bedrooms) payload.bedrooms = Number.parseInt(data.bedrooms, 10);
        if (data.bathrooms) payload.bathrooms = Number.parseInt(data.bathrooms, 10);
        if (data.date) payload.date = data.date;
        if (photoPath) payload.photo_path = photoPath;

        const { error: insertErr } = await supabase.from("bookings").insert(payload);

        if (!insertErr) {
          setBookingRef(ref);
          if (photoFailed) setPhotoNote("Your photo could not be uploaded, but the booking itself was still saved.");
          setSubmitted(true);
          setSubmitting(false);
          try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
          return;
        }
        if (insertErr.code === "23505") { lastError = insertErr; continue; }
        throw insertErr;
      }
      throw lastError || new Error("Could not create a unique booking reference. Please try again.");
    } catch (err: any) {
      setError(friendlyError(err));
      setSubmitting(false);
    }
  };

  if (submitted) return <main><SiteHeader minimal />
    <div className="booking-wrap"><div className="booking-shell">
      <div className="eyebrow">REQUEST RECEIVED</div>
      <h2>Thank you.</h2>
      <p className="lead">Your cleaning request has been received. MALTO will review the request, check availability, confirm the final price and contact you.</p>
      <div className="notice">
        <strong>Request ID:</strong> {bookingRef}<br/>
        <strong>Requested:</strong> {fmtDate(data.date)} — {data.slot_label || data.time}<br/>
        <strong>Cleaner:</strong> {chosenPartner ? chosenPartner.name : "To be assigned by MALTO"}
      </div>
      {photoNote && <div className="notice">{photoNote}</div>}
      <Link className="btn" href="/">BACK TO HOME</Link>
    </div></div></main>;

  const PHOTO_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/team-photos`;

  return <main><SiteHeader backHref="/" minimal />
  <div className="booking-wrap"><div className="booking-shell">
    <div className="progress">{steps.map((_, i) => <span className={i <= step ? "active" : ""} key={i} />)}</div>
    <div className="eyebrow">STEP {step+1} OF {steps.length}</div>
    <h2>{steps[step]}</h2>

    {restored && step === 0 && (
      <div className="notice">
        We kept what you already filled in.{" "}
        <button className="linkbtn" onClick={() => { try { window.localStorage.removeItem(DRAFT_KEY); } catch {} setData({ service: "", property: "", areas: [], condition: "Normal", materials: "Customer provides materials", time: "Morning", photo: null }); setRestored(false); }}>Start over</button>
      </div>
    )}

    {step === 0 && <>
      <div className="choice-grid">{serviceOptions.map(x => <label className="choice" key={x}><input type="radio" checked={data.service === x} onChange={() => set("service", x)} />{x}</label>)}</div>
      {recurringOnly.length > 0 && <>
        <div className="eyebrow" style={{ margin: "30px 0 4px" }}>HOW OFTEN</div>
        <p className="small muted" style={{ margin: "0 0 12px" }}>Booking on a schedule means the same visit repeats automatically, and the price drops.</p>
        <div className="choice-grid">
          <label className="choice"><input type="radio" name="frequency" checked={!data.frequency || data.frequency === "once"} onChange={() => set("frequency", "once")} />One-time</label>
          {recurringOnly.map(p => <label className="choice" key={p.frequency}>
            <input type="radio" name="frequency" checked={data.frequency === p.frequency} onChange={() => set("frequency", p.frequency)} />
            {p.clientLabel || p.label}
            {p.discountPct > 0 && <span className="small" style={{ display: "block", color: "#3F6B4F", marginTop: 6 }}>Save {p.discountPct}%</span>}
          </label>)}
        </div>
        {discountPct > 0 && <div className="estimate" style={{ marginTop: 18 }}>
          <p style={{ margin: "0 0 6px" }}>Estimated per visit: <strong>{estimate.price}</strong></p>
          <p className="small muted" style={{ margin: 0 }}>Was {estimate.basePrice}. Final price is confirmed after MALTO reviews the request.</p>
        </div>}
      </>}
    </>}

    {step === 1 && <div className="form-grid">
      <div className="field"><label>Property Type</label><select value={data.property} onChange={e => set("property", e.target.value)}><option value="">Select</option>{propertyOptions.map(x => <option key={x}>{x}</option>)}</select></div>
      <div className="field"><label>Approximate sqm</label><input value={data.sqm || ""} onChange={e => set("sqm", e.target.value)} /></div>
      <div className="field"><label>Bedrooms</label><input type="number" min={0} value={data.bedrooms || ""} onChange={e => set("bedrooms", e.target.value)} /></div>
      <div className="field"><label>Bathrooms</label><input type="number" min={0} value={data.bathrooms || ""} onChange={e => set("bathrooms", e.target.value)} /></div>
    </div>}

    {step === 2 && <>
      <div className="choice-grid">{areas.map(a => <label className="choice" key={a}><input type="checkbox" checked={(data.areas||[]).includes(a)} onChange={() => toggleArea(a)} />{a}</label>)}</div>
      <div className="field" style={{ marginTop: 18 }}><label>Condition</label><select value={data.condition} onChange={e => set("condition", e.target.value)}>{["Light","Normal","Needs attention","Heavy buildup"].map(x => <option key={x}>{x}</option>)}</select></div>
      <div className="field" style={{ marginTop: 18 }}><label>Notes</label><textarea value={data.scopeNotes || ""} onChange={e => set("scopeNotes", e.target.value)} /></div>
    </>}

    {step === 3 && <div className="choice-grid">{["Customer provides materials","MALTO provides materials"].map(x => <label className="choice" key={x}><input type="radio" checked={data.materials === x} onChange={() => set("materials", x)} />{x}</label>)}</div>}

    {step === 4 && <div className="form-grid">
      <div className="field full"><label>Address</label><input value={data.address || ""} onChange={e => set("address", e.target.value)} placeholder="House number and street" /></div>
      <div className="field">
        <label>City / Municipality</label>
        <input
          value={data.city_label || cityQuery}
          onChange={e => {
            // Typing means the previous pick no longer applies, so the
            // province and the code are cleared instead of going stale.
            setCityQuery(e.target.value);
            setData(d => ({ ...d, city_label: "", city: "", city_code: "", province: "" }));
          }}
          placeholder="Start typing, then pick from the list"
          autoComplete="off"
        />
        {cityMatches.length > 0 && <div className="picker">
          {cityMatches.map(c => <button type="button" key={c.code} onClick={() => pickCity(c)}>
            <strong>{c.display_name}</strong><span className="small muted">{c.province_name || "—"}</span>
          </button>)}
        </div>}
        {data.city_label && <span className="small muted" style={{ marginTop: 6 }}>Selected: {data.city_label}</span>}
        {!cities.length && <span className="small muted" style={{ marginTop: 6 }}>Loading the city list…</span>}
      </div>
      <div className="field"><label>Province</label>
        <input value={data.province || ""} readOnly placeholder="Filled in from your city" />
        <span className="small muted">Taken from the city you picked, so the address always matches a real place.</span>
      </div>
      <div className="field"><label>Landmark</label><input value={data.landmark || ""} onChange={e => set("landmark", e.target.value)} /></div>
      <div className="field"><label>Access instructions</label><input value={data.access || ""} onChange={e => set("access", e.target.value)} placeholder="Gate code, parking, dogs" /></div>
    </div>}

    {step === 5 && <>
      <p className="small muted" style={{ margin: "0 0 16px" }}>
        {data.city_code
          ? `Showing partners who work in ${data.city_label}.`
          : "Choose your city first so we can show you partners who cover your area."}
        {" "}Leaving it open is completely fine — MALTO assigns the best available partner.
      </p>
      <button className={"choosecard" + (!data.partner_id ? " on" : "")} onClick={() => setData(d => ({ ...d, partner_id: null, starts_at: null, slot_label: "" }))}>
        <div><strong>No preference</strong><p className="small muted" style={{ margin: "2px 0 0" }}>We assign the best available partner for your area and date.</p></div>
        {!data.partner_id && <span className="tick">✓</span>}
      </button>
      {eligiblePartners.length === 0 ? (
        <p className="text">No partners are listed for this city yet. Choose no preference and we will assign someone.</p>
      ) : (
        <div className="chooserow-grid">
          {eligiblePartners.map(p => {
            const on = data.partner_id === p.id;
            return <button key={p.id} className={"choosecard" + (on ? " on" : "")} onClick={() => setData(d => ({ ...d, partner_id: on ? null : p.id, starts_at: null, slot_label: "" }))}>
              <div className="choosecard-main">
                {p.photo_path
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`${PHOTO_BASE}/${p.photo_path}`} alt="" className="avatar" width={52} height={52} />
                  : <span className="avatar-fallback" style={{ width: 52, height: 52, fontSize: 20 }}>{(p.name||"?").slice(0,1).toUpperCase()}</span>}
                <div>
                  <strong>{p.name}</strong>
                  {p.verified && <span className="badge on" style={{ marginLeft: 8 }}>Verified</span>}
                  <p className="small muted" style={{ margin: "2px 0 0" }}>{p.headline || p.tagline || "Cleaning partner"}</p>
                  {!!p.specialties?.length && <p className="small muted" style={{ margin: "2px 0 0" }}>{p.specialties.join(" · ")}</p>}
                </div>
              </div>
              {on && <span className="tick">✓</span>}
            </button>;
          })}
        </div>
      )}
    </>}

    {step === 6 && <>
      <div className="form-grid">
        <div className="field"><label>Preferred Date</label>
          <input type="date" min={manilaToday()} value={data.date || ""} onChange={e => set("date", e.target.value)} />
          <span className="small muted">Today is fine if a cleaner still has a free start. Otherwise we ask for a day's notice.</span>
        </div>
        <div className="field"><label>Time of day</label>
          <select value={data.time} onChange={e => set("time", e.target.value)}>
            {windows.map(w => <option key={w}>{w}</option>)}
          </select>
        </div>
      </div>
      {chosenPartner ? (
        <div className="field" style={{ marginTop: 22 }}>
          <label>Start time with {chosenPartner.name}</label>
          {slotsBusy ? <p className="small muted">Checking {chosenPartner.name}'s calendar…</p>
            : slotsFailed ? <p className="small muted">
                We could not reach the availability calendar just now. Try again, or choose no preference and we will
                arrange a time with you.
              </p>
            : slots.length === 0 ? <p className="small muted">
                {chosenPartner.name} has no open starts in this window on that day. Try another day, another time of day, or choose no preference.
              </p>
            : <div className="slotgrid">
                {slots.map(s => <button key={s.starts_at} type="button"
                  className={"slot" + (data.starts_at === s.starts_at ? " on" : "")}
                  onClick={() => setData(d => ({ ...d, starts_at: s.starts_at, slot_label: s.label }))}>
                  {s.label}
                </button>)}
              </div>}
          <span className="small muted" style={{ marginTop: 8 }}>Live availability, 30-minute start times. Held for you only once you press Request booking.</span>
        </div>
      ) : (
        <div className="notice" style={{ marginTop: 18 }}>
          You did not choose a cleaner, so the exact start time is confirmed by MALTO. We will match you with a
          partner who works {data.city_label ? `in ${data.city_label}` : "in your area"} and contact you to agree a time.
        </div>
      )}
    </>}

    {step === 7 && <div className="form-grid">
      <div className="field"><label>Full Name</label><input value={data.name || ""} onChange={e => set("name", e.target.value)} autoComplete="name" /></div>
      <div className="field"><label>Mobile Number</label><input inputMode="tel" value={data.mobile || ""} onChange={e => set("mobile", e.target.value)} placeholder="0917 123 4567" autoComplete="tel" /></div>
      <div className="field full"><label>Email</label><input type="email" value={data.email || ""} onChange={e => set("email", e.target.value)} autoComplete="email" /></div>
      <div className="field full"><label>Notes</label><textarea value={data.notes || ""} onChange={e => set("notes", e.target.value)} /></div>
      <div className="field full"><label>Optional Photo Upload</label>
        <input type="file" accept="image/*" onChange={e => onPhoto(e.target.files?.[0] || null)} />
        <span className="small">{data.photo ? `${data.photo.name} — ${(data.photo.size/1024/1024).toFixed(1)}MB (max 5MB)` : "JPG, PNG, WEBP, GIF or HEIC"}</span>
      </div>
    </div>}

    {step === LAST && <>
      <div className="notice">Final price is confirmed after MALTO reviews the request. Nothing is charged now.</div>
      <div className="review">
        <ReviewRow label="Service" value={data.service} edit={0} onEdit={goTo} />
        <ReviewRow label="Frequency" value={`${chosenPlan?.label || "One-time"}${discountPct ? ` (${discountPct}% recurring discount applied)` : ""}`} edit={0} onEdit={goTo} />
        <ReviewRow label="Property" value={[data.property, data.sqm ? `${data.sqm} sqm` : "", data.bedrooms ? `${data.bedrooms} bed` : "", data.bathrooms ? `${data.bathrooms} bath` : ""].filter(Boolean).join(" · ")} edit={1} onEdit={goTo} />
        <ReviewRow label="Rooms" value={(data.areas||[]).join(", ") || "Whole place"} edit={2} onEdit={goTo} />
        <ReviewRow label="Condition" value={data.condition} edit={2} onEdit={goTo} />
        <ReviewRow label="Materials" value={data.materials} edit={3} onEdit={goTo} />
        <ReviewRow label="Address" value={[data.address, data.city_label, data.landmark].filter(Boolean).join(", ")} edit={4} onEdit={goTo} />
        <ReviewRow label="Access" value={data.access} edit={4} onEdit={goTo} />
        <ReviewRow label="Cleaner" value={chosenPartner ? `${chosenPartner.name}${chosenPartner.verified ? " (verified)" : ""}` : "To be assigned by MALTO"} edit={5} onEdit={goTo} />
        <ReviewRow label="Date" value={fmtDate(data.date)} edit={6} onEdit={goTo} />
        <ReviewRow label="Start time" value={data.slot_label || `${data.time} (to be confirmed)`} edit={6} onEdit={goTo} />
        <ReviewRow label="Contact" value={[data.name, data.mobile, data.email].filter(Boolean).join(" · ")} edit={7} onEdit={goTo} />
        <ReviewRow label="Notes" value={data.notes} edit={7} onEdit={goTo} />
        {data.photo && <ReviewRow label="Photo" value={(data.photo as File).name} edit={7} onEdit={goTo} />}
      </div>
      <div className="estimate">
        <p><strong>Estimated cleaners:</strong> {estimate.cleaners}</p>
        <p><strong>Estimated hours:</strong> {estimate.hours}</p>
        <p><strong>Estimated price range:</strong> {estimate.price}{discountPct > 0 && <span className="small muted"> (was {estimate.basePrice})</span>}</p>
      </div>
      {data.frequency && data.frequency !== "once" && data.date && (
        <p className="small muted" style={{ marginTop: 12 }}>
          Your first visit is {fmtDate(data.date)}. The same booking repeats automatically {chosenPlan?.label.toLowerCase() ?? "weekly"} after that, and you will get an email before each one.
        </p>
      )}
    </>}

    {error && <div className="notice" style={{ background: "#FBE9E7", color: "#8A2C1D" }}>{error}</div>}

    <div className="booking-actions">
      {step > 0
        ? <button className="btn secondary" onClick={back} disabled={submitting} style={{ opacity: submitting ? .6 : 1 }}>BACK</button>
        : <span />}
      {step < LAST
        ? <button className="btn" onClick={next}>CONTINUE</button>
        : <button className="btn" onClick={submitBooking} disabled={submitting} style={{ opacity: submitting ? .6 : 1, pointerEvents: submitting ? "none" : "auto" }}>{submitting ? "SUBMITTING…" : "REQUEST BOOKING"}</button>}
    </div>
  </div></div></main>;
}

function ReviewRow({ label, value, edit, onEdit }: {
  label: string; value?: any; edit: number; onEdit: (step: number) => void;
}) {
  const empty = value === undefined || value === null || value === "";
  return <div className="review-row">
    <div>
      <span className="review-label">{label}</span>
      <span className={empty ? "review-empty" : "review-value"}>{empty ? "Not given" : value}</span>
    </div>
    <button type="button" className="linkbtn" onClick={() => onEdit(edit)}>EDIT</button>
  </div>;
}
