"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

const TEAM_BUCKET = "team-photos";

type Member = {
  id: string; name: string; role: string; phone: string; email: string;
  hire_date: string; bio: string; photo_path: string; active: boolean; sort_order: string;
  isNew?: boolean;
  user_id: string; portal_status: string; available: boolean; unavailable_note: string;
  // Marketplace
  slug: string; headline: string; tagline: string;
  years_experience: string; verified: boolean; is_sample: boolean; is_accepting_jobs: boolean;
  service_ids: string[]; city_codes: string[];
};

type City = { code: string; display_name: string; province_name: string; disambiguated: boolean };
type ServiceOpt = { id: string; name: string };
type Hours = { weekday: number; start_time: string; end_time: string };
type TimeOff = { on_date: string; reason: string };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Coerced on save, never in onChange, so a cleared box can stay empty.
const num = (v: string | number) => Number(String(v).replace(/[^0-9.]/g, "")) || 0;

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const blank = (): Member => ({
  id: "", name: "", role: "", phone: "", email: "", hire_date: "", bio: "", photo_path: "",
  active: true, sort_order: "99", isNew: true, user_id: "", portal_status: "invited",
  available: true, unavailable_note: "",
  slug: "", headline: "", tagline: "", years_experience: "", verified: false,
  is_sample: false, is_accepting_jobs: true, service_ids: [], city_codes: [],
});

export default function TeamAdmin() {
  const [items, setItems] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);

  const [services, setServices] = useState<ServiceOpt[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [agreed, setAgreed] = useState<Set<string>>(new Set());
  const [hours, setHours] = useState<Record<string, Hours[]>>({});
  const [timeOff, setTimeOff] = useState<Record<string, TimeOff[]>>({});
  const [cityQuery, setCityQuery] = useState<Record<string, string>>({});

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 2600); };

  // Job load per member, so the roster shows who is already carrying work.
  const [jobLoad, setJobLoad] = useState<Record<string, { open: number; next: string | null }>>({});
  const loadCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/assignments");
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j.ok) return;
      const out: Record<string, { open: number; next: string | null }> = {};
      for (const a of (j.assignments ?? [])) {
        if (a.status === "declined" || a.status === "cancelled") continue;
        const bd = (a as any).booking_date as { date?: string } | null;
        const rec = out[a.member_id] ?? { open: 0, next: null };
        rec.open += 1;
        if (bd?.date && (!rec.next || bd.date < rec.next)) rec.next = bd.date;
      }
      setJobLoad(out);
    } catch { /* the roster still works without the counts */ }
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error: err } = await supabase.from("team_members").select("*").order("sort_order");
      if (err) throw err;
      const rows = data || [];

      // Everything the marketplace needs, fetched by id so it costs one request
      // per relation instead of one per partner.
      const ids = rows.map((m) => m.id);
      const [svc, ar, agr, hrs, off] = await Promise.all([
        supabase.from("services").select("id,name").eq("active", true).order("sort_order"),
        ids.length ? supabase.from("partner_areas").select("partner_id,city_code").in("partner_id", ids) : { data: [] },
        ids.length ? supabase.from("partner_agreements").select("partner_id").in("partner_id", ids) : { data: [] },
        ids.length ? supabase.from("partner_availability_rules").select("partner_id,weekday,start_time,end_time").in("partner_id", ids) : { data: [] },
        ids.length ? supabase.from("partner_time_off").select("partner_id,on_date,reason").in("partner_id", ids) : { data: [] },
      ]);
      if (svc.error) throw svc.error;
      setServices(svc.data || []);

      const byPartner: Record<string, string[]> = {};
      for (const r of (ar.data ?? [])) (byPartner[r.partner_id] ??= []).push(r.city_code);
      setAgreed(new Set((agr.data ?? []).map((a) => a.partner_id)));
      const h: Record<string, Hours[]> = {};
      for (const r of (hrs.data ?? [])) (h[r.partner_id] ??= []).push(r);
      setHours(h);
      const o: Record<string, TimeOff[]> = {};
      for (const r of (off.data ?? [])) (o[r.partner_id] ??= []).push(r);
      setTimeOff(o);

      setItems(rows.map((m) => ({
        id: m.id, name: m.name, role: m.role, phone: m.phone, email: m.email,
        hire_date: m.hire_date || "", bio: m.bio, photo_path: m.photo_path,
        active: m.active, sort_order: String(m.sort_order ?? ""),
        user_id: m.user_id || "", portal_status: m.portal_status || "invited",
        available: m.available !== false, unavailable_note: m.unavailable_note || "",
        slug: m.slug || "", headline: m.headline || "", tagline: m.tagline || "",
        years_experience: m.years_experience == null ? "" : String(m.years_experience),
        verified: m.verified === true, is_sample: m.is_sample === true,
        is_accepting_jobs: m.is_accepting_jobs !== false,
        service_ids: [], city_codes: byPartner[m.id] ?? [],
      })));
    } catch (e: any) { setError(e?.message || "Could not load the team."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The city list is only needed when a profile is open, so it loads on demand.
  useEffect(() => {
    if (!open) return;
    if (cities.length) return;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("cities").select("code,display_name,province_name,disambiguated")
        .order("display_name").limit(4000);
      setCities(data ?? []);
    })();
  }, [open, cities.length]);

  // Lazily create signed URLs for every uploaded photo (idempotent).
  useEffect(() => {
    const seen: Record<string, boolean> = {};
    const need = items.map((m) => m.photo_path).filter((p) => !!p && !seen[p] && (seen[p] = true) && !photos[p]);
    if (!need.length) return;
    let alive = true;
    (async () => {
      const supabase = createClient();
      for (const p of need) {
        try {
          const { data, error } = await supabase.storage.from(TEAM_BUCKET).createSignedUrl(p, 3600);
          if (!alive) return;
          if (!error && data?.signedUrl) setPhotos((prev) => ({ ...prev, [p]: data.signedUrl }));
        } catch { /* photo is optional */ }
      }
    })();
    return () => { alive = false; };
  }, [items, photos]);

  const signPhoto = async (path: string) => {
    if (!path || photos[path]) return;
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage.from(TEAM_BUCKET).createSignedUrl(path, 3600);
      if (!error && data?.signedUrl) setPhotos((p) => ({ ...p, [path]: data.signedUrl }));
    } catch { /* optional */ }
  };

  const patch = (id: string, p: Partial<Member>) =>
    setItems((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const setPortal = async (m: Member, status: string) => {
    if (busy) return;
    setBusy(m.id); setError(null);
    try {
      const supabase = createClient();
      const patchBody: Record<string, unknown> = { portal_status: status };
      // Approving someone who has no account yet would strand them: a member
      // with no user_id can never sign in to see anything.
      if (status === "approved" && !m.user_id) patchBody.portal_status = "invited";
      const { error: err } = await supabase.from("team_members").update(patchBody).eq("id", m.id);
      if (err) throw err;
      flash(status === "approved" ? `${m.name} can now be assigned jobs.` : `${m.name} was not approved.`);
      await load();
    } catch (e: any) { setError(e?.message || "Could not update the member."); }
    finally { setBusy(null); }
  };

  /** Verified is the one badge a customer trusts, so it flips on its own. */
  const toggleVerified = async (m: Member) => {
    if (busy) return;
    setBusy(m.id); setError(null);
    try {
      const supabase = createClient();
      const { error: err } = await supabase
        .from("team_members").update({ verified: !m.verified }).eq("id", m.id);
      if (err) throw err;
      flash(!m.verified ? `${m.name} is now shown as verified.` : `Verified badge removed from ${m.name}.`);
      await load();
    } catch (e: any) { setError(e?.message || "Could not change the verified badge."); }
    finally { setBusy(null); }
  };

  const onPhoto = async (id: string, file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Images only."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Max 5MB."); return; }
    setBusy(id); setError(null);
    try {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${crypto.randomUUID()}/photo.${ext}`;
      const { error: err } = await supabase.storage.from(TEAM_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (err) throw err;
      const old = items.find((x) => x.id === id)?.photo_path;
      setItems((l) => l.map((x) => (x.id === id ? { ...x, photo_path: path } : x)));
      if (old) try { await supabase.storage.from(TEAM_BUCKET).remove([old]); } catch { /* old photo cleanup */ }
      flash("Photo uploaded. Remember to save the profile.");
    } catch (e: any) { setError(e?.message || "Photo upload failed."); }
    finally { setBusy(null); }
  };

  const save = async (m: Member) => {
    if (busy) return;
    setBusy(m.id || "new"); setError(null);
    try {
      if (!m.name.trim()) throw new Error("A name is required.");
      const supabase = createClient();
      const profile = {
        name: m.name.trim(), role: m.role, phone: m.phone, email: m.email,
        hire_date: m.hire_date || null, bio: m.bio, photo_path: m.photo_path,
        active: m.active, sort_order: num(m.sort_order),
        headline: m.headline, tagline: m.tagline,
        years_experience: m.years_experience === "" ? null : num(m.years_experience),
        verified: m.verified, is_accepting_jobs: m.is_accepting_jobs,
      };

      let id = m.id;
      if (m.isNew) {
        // A slug is the partner's public address, so make sure it is free
        // before writing, otherwise one partner can silently take another's URL.
        const base = slugify(m.slug || m.name);
        if (!base) throw new Error("Could not make a web address from that name. Set one by hand.");
        const { data: taken } = await supabase
          .from("team_members").select("id").eq("slug", base).maybeSingle();
        if (taken) throw new Error(`The web address "${base}" is already in use. Change the name or set a different one.`);

        const { data: created, error: err } = await supabase
          .from("team_members")
          .insert({ ...profile, slug: base, portal_status: "invited", user_id: null })
          .select("id").single();
        if (err) throw err;
        id = created.id;
      } else {
        // Deliberately does not include user_id, portal_status, available or
        // is_sample. Those belong to the portal and the approval queue; writing
        // them here used to un-approve the partner and unlink their login
        // every time an admin fixed a typo in their name.
        const { error: err } = await supabase
          .from("team_members").update(profile).eq("id", m.id);
        if (err) throw err;
      }

      // Coverage and specialties live in their own tables, so they are written
      // only when they actually changed, and never from the row state.
      const current = items.find((x) => x.id === m.id);
      if (!m.isNew && current) {
        const svcSame =
          current.service_ids.length === m.service_ids.length &&
          current.service_ids.every((v) => m.service_ids.includes(v));
        if (!svcSame) {
          const { error: e1 } = await supabase.from("partner_services").delete().eq("partner_id", id);
          if (e1) throw e1;
          if (m.service_ids.length) {
            const { error: e2 } = await supabase.from("partner_services")
              .insert(m.service_ids.map((service_id) => ({ partner_id: id, service_id })));
            if (e2) throw e2;
          }
        }
        const citySame =
          current.city_codes.length === m.city_codes.length &&
          current.city_codes.every((v) => m.city_codes.includes(v));
        if (!citySame) {
          const { error: e1 } = await supabase.from("partner_areas").delete().eq("partner_id", id);
          if (e1) throw e1;
          if (m.city_codes.length) {
            const { error: e2 } = await supabase.from("partner_areas")
              .insert(m.city_codes.map((city_code) => ({ partner_id: id, city_code })));
            if (e2) throw e2;
          }
        }
      }

      flash(m.isNew ? "Partner added. Approve them when they can sign in." : "Partner saved.");
      setOpen(null);
      await load();
    } catch (e: any) { setError(e?.message || "Could not save."); }
    finally { setBusy(null); }
  };

  /**
   * A partner is never hard-deleted. Their booking history points at this row,
   * and the agreement table refuses deletes outright, so "remove" means take
   * them out of circulation and keep the record.
   */
  const deactivate = async (m: Member) => {
    if (!m.id) return;
    if (!confirm(`Take ${m.name} off the marketplace? Their booking history is kept, and you can bring them back later.`)) return;
    setBusy(m.id); setError(null);
    try {
      const supabase = createClient();
      const { error: err } = await supabase.from("team_members")
        .update({ active: false, is_accepting_jobs: false, portal_status: "blocked" })
        .eq("id", m.id);
      if (err) throw err;
      flash(`${m.name} is no longer bookable. Their history is kept.`);
      await load();
    } catch (e: any) { setError(e?.message || "Could not take the partner off."); }
    finally { setBusy(null); }
  };

  const reactivate = async (m: Member) => {
    if (busy) return;
    setBusy(m.id); setError(null);
    try {
      const supabase = createClient();
      const { error: err } = await supabase.from("team_members")
        .update({ active: true, is_accepting_jobs: true }).eq("id", m.id);
      if (err) throw err;
      flash(`${m.name} is back on the marketplace.`);
      await load();
    } catch (e: any) { setError(e?.message || "Could not bring the partner back."); }
    finally { setBusy(null); }
  };

  /** Samples are throwaway fixtures with no bookings, so a real delete is safe. */
  const deleteSample = async (m: Member) => {
    if (!m.id) return;
    if (!confirm(`Delete the sample partner ${m.name}? This is only for the example profiles.`)) return;
    setBusy(m.id); setError(null);
    try {
      const supabase = createClient();
      const { error: err } = await supabase.from("team_members").delete().eq("id", m.id);
      if (err) throw err;
      if (m.photo_path) try { await supabase.storage.from(TEAM_BUCKET).remove([m.photo_path]); } catch { /* ignore */ }
      flash("Sample deleted.");
      await load();
    } catch (e: any) { setError(e?.message || "Could not delete the sample."); }
    finally { setBusy(null); }
  };

  const deleteAllSamples = async () => {
    const samples = items.filter((m) => m.is_sample);
    if (!samples.length) return;
    if (!confirm(`Delete all ${samples.length} sample partners?`)) return;
    setBusy("samples"); setError(null);
    try {
      const supabase = createClient();
      for (const s of samples) {
        const { error: err } = await supabase.from("team_members").delete().eq("id", s.id);
        if (err) throw err;
        if (s.photo_path) try { await supabase.storage.from(TEAM_BUCKET).remove([s.photo_path]); } catch { /* ignore */ }
      }
      flash(`${samples.length} sample partners deleted.`);
      await load();
    } catch (e: any) { setError(e?.message || "Could not delete the samples."); }
    finally { setBusy(null); }
  };

  const sampleCount = items.filter((m) => m.is_sample).length;

  return <>
    {error && <div className="notice" style={{ background: "#FBE9E7", color: "#8A2C1D" }}>{error}</div>}
    {notice && <div className="notice">{notice}</div>}

    <div className="eyebrow">PARTNERS</div>
    <h1>The people who do the work.</h1>
    <p className="small muted">
      This is the partner roster. Anything you approve and mark active here can appear on the public site.
    </p>

    {(() => {
      const pending = items.filter((m) => !m.isNew && m.portal_status === "pending");
      if (!pending.length) return null;
      return <div className="panel" style={{ marginBottom: 20, borderLeft: "4px solid #C9962B" }}>
        <div className="panel-head">
          <strong>Waiting for approval</strong>
          <span className="small muted">{pending.length} applicant{pending.length === 1 ? "" : "s"}</span>
        </div>
        <p className="small muted" style={{ margin: "0 0 14px" }}>
          These people created their own account and signed the partner agreement. Until you approve them they
          can sign in but cannot see any jobs.
        </p>
        {pending.map((m) => (
          <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px dashed var(--border)", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 14 }}>{m.name}</strong>
            <span className="small muted">{m.email}{m.phone ? ` · ${m.phone}` : ""}</span>
            {agreed.has(m.id) && <span className="badge on">Agreement signed</span>}
            {!m.user_id && <span className="badge">No account yet</span>}
            <span style={{ flex: 1 }} />
            <button className="btn" style={{ minHeight: 38 }} disabled={busy === m.id} onClick={() => setPortal(m, "approved")}>
              {busy === m.id ? "…" : "APPROVE"}
            </button>
            <button className="btn secondary" style={{ minHeight: 38 }} disabled={busy === m.id} onClick={() => setPortal(m, "blocked")}>
              REJECT
            </button>
          </div>
        ))}
      </div>;
    })()}

    {sampleCount > 0 && (
      <div className="panel" style={{ marginBottom: 20, borderLeft: "4px solid #7C8F86" }}>
        <div className="panel-head">
          <strong>{sampleCount} sample partner{sampleCount === 1 ? "" : "s"} are on the public site</strong>
          <button className="btn secondary" style={{ minHeight: 36 }} disabled={busy === "samples"} onClick={deleteAllSamples}>
            {busy === "samples" ? "…" : "REMOVE ALL SAMPLES"}
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          These are examples, clearly marked SAMPLE, and cannot be booked. Replace them as the real crew signs up.
        </p>
      </div>
    )}

    <div className="toolbar">
      <button className="btn" style={{ minHeight: 42 }} onClick={() => { setItems((l) => [blank(), ...l]); setOpen("new"); }}>+ ADD PARTNER</button>
      <span className="small muted">{items.length} partner{items.length === 1 ? "" : "s"}</span>
    </div>

    {loading ? <p className="text" style={{ padding: 20 }}>Loading partners…</p>
      : items.length === 0 ? <p className="text" style={{ padding: 20 }}>No partners yet. They can also sign up themselves from the site.</p>
      : <div className="teamgrid">
        {items.map((m) => {
          const key = m.id || "new";
          const isOpen = open === key;
          const done = completeness(m, agreed.has(m.id));
          const chosen = new Set(m.city_codes);
          const q = (cityQuery[key] ?? "").trim().toLowerCase();
          const matches = (q && cities.length)
            ? cities.filter((c) =>
                c.display_name.toLowerCase().includes(q) ||
                (c.province_name || "").toLowerCase().includes(q)
              ).slice(0, 8)
            : [];
          return <div className="teamcard" key={key}>
            <div className="teamcard-top" onClick={() => setOpen(isOpen ? null : key)}>
              {m.photo_path && photos[m.photo_path]
                ? <img src={photos[m.photo_path]} alt={m.name} className="teamphoto" />
                : <div className="teamphoto teamphoto-empty">{(m.name || "?").slice(0, 1).toUpperCase()}</div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong className="custcard-name">{m.name || "New partner"}</strong>
                <div className="small muted">{m.headline || m.role || "No headline yet"}</div>
                <div className="small muted">
                  {m.years_experience ? `${m.years_experience} yr experience · ` : ""}
                  <span className={"badge" + (m.active ? " on" : "")}>{m.active ? "Active" : "Off the marketplace"}</span>
                </div>
                <div className="small muted" style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {m.is_sample && <span className="badge warn">Sample</span>}
                  {m.verified && <span className="badge on">Verified</span>}
                  {m.portal_status === "pending" && <span className="badge">Waiting for approval</span>}
                  {m.portal_status === "approved" && <span className="badge on">Portal active</span>}
                  {m.portal_status === "invited" && !m.user_id && <span className="badge">No account yet</span>}
                  {m.user_id && m.portal_status === "approved" && (
                    <span className={"badge" + (m.available ? " on" : "")}>{m.available ? "Available" : "Unavailable"}</span>
                  )}
                  {jobLoad[m.id]?.open
                    ? <span className="member-load">{jobLoad[m.id].open} open job{jobLoad[m.id].open === 1 ? "" : "s"}{jobLoad[m.id].next ? ` · next ${jobLoad[m.id].next}` : ""}</span>
                    : (m.portal_status === "approved" && m.user_id && <span className="member-load">No open jobs</span>)}
                </div>
                {!m.isNew && (
                  <div className="small muted" style={{ marginTop: 6 }}>
                    Profile {done.done}/{done.total} complete
                    {done.total > 0 && (
                      <span className="complete-bar" aria-hidden="true">
                        <span style={{ width: `${Math.round((done.done / done.total) * 100)}%` }} />
                      </span>
                    )}
                  </div>
                )}
              </div>
              <span className="small muted">{isOpen ? "▾" : "▸"}</span>
            </div>

            {isOpen && <div className="teamcard-body" onClick={(e) => e.stopPropagation()}>
              {m.id && !m.is_sample && (
                <div className="verifystrip">
                  <div>
                    <strong>Verified partner</strong>
                    <p className="small muted" style={{ margin: "2px 0 0" }}>
                      Shows a verified badge on the public profile. Only switch this on once you have checked their
                      ID and the agreement they signed.
                    </p>
                  </div>
                  <button
                    className={"btn" + (m.verified ? " secondary" : "")}
                    style={{ minHeight: 40, flex: "0 0 auto" }}
                    disabled={busy === key}
                    onClick={() => toggleVerified(m)}
                  >
                    {m.verified ? "REMOVE BADGE" : "MARK VERIFIED"}
                  </button>
                </div>
              )}

              <div className="form-grid">
                <div className="field"><label>Full name</label>
                  <input value={m.name} onChange={(e) => patch(key, { name: e.target.value })} placeholder="Juan Dela Cruz" /></div>
                <div className="field"><label>Headline</label>
                  <input value={m.headline} onChange={(e) => patch(key, { headline: e.target.value })} placeholder="Deep cleaning specialist, 6 years" /></div>
                <div className="field"><label>Phone</label>
                  <input value={m.phone} onChange={(e) => patch(key, { phone: e.target.value })} placeholder="09xx xxx xxxx" /></div>
                <div className="field"><label>Email</label>
                  <input type="email" value={m.email} onChange={(e) => patch(key, { email: e.target.value })} placeholder="name@example.com" /></div>
                <div className="field"><label>Years of experience</label>
                  <input type="number" min={0} max={60} value={m.years_experience}
                    onChange={(e) => patch(key, { years_experience: e.target.value })} placeholder="5" /></div>
                <div className="field"><label>Date hired</label>
                  <input type="date" value={m.hire_date} onChange={(e) => patch(key, { hire_date: e.target.value })} /></div>
                <div className="field full"><label>Short tagline</label>
                  <input value={m.tagline} onChange={(e) => patch(key, { tagline: e.target.value })}
                    placeholder="One line a customer reads at a glance." /></div>
                <div className="field full"><label>About them</label>
                  <textarea value={m.bio} onChange={(e) => patch(key, { bio: e.target.value })}
                    placeholder="Experience, what they are good at, and how they work." /></div>
                {m.slug && <div className="field full"><label>Public web address</label>
                  <input value={m.slug} readOnly />
                  <span className="small muted">Set from the name. The public profile lives at /partners/{m.slug}.</span></div>}

                <div className="field full">
                  <label>Photo (max 5MB)</label>
                  <input type="file" accept="image/*" onChange={(e) => onPhoto(key, e.target.files?.[0] || null)} />
                  {m.photo_path && (photos[m.photo_path]
                    ? <img src={photos[m.photo_path]} alt="" style={{ width: 120, height: 120, objectFit: "cover", border: "1px solid var(--border)" }} />
                    : <span className="small muted">Photo uploaded. <button className="linkbtn" onClick={() => signPhoto(m.photo_path)}>Show it</button></span>)}
                </div>
              </div>

              <div className="field" style={{ marginTop: 16 }}>
                <label>What they take on</label>
                <div className="chipset">
                  {services.map((s) => {
                    const on = m.service_ids.includes(s.id);
                    return <button type="button" key={s.id}
                      className={"chip" + (on ? " on" : "")}
                      onClick={() => patch(key, {
                        service_ids: on ? m.service_ids.filter((x) => x !== s.id) : [...m.service_ids, s.id],
                      })}>
                      {s.name}
                    </button>;
                  })}
                </div>
              </div>

              <div className="field" style={{ marginTop: 16 }}>
                <label>Where they work</label>
                {!!m.city_codes.length && (
                  <div className="chipset" style={{ marginBottom: 10 }}>
                    {m.city_codes.map((code) => {
                      const c = cities.find((x) => x.code === code);
                      return <button type="button" key={code} className="chip on"
                        onClick={() => patch(key, { city_codes: m.city_codes.filter((x) => x !== code) })}
                        title="Remove">
                        {c ? c.display_name : code} ×
                      </button>;
                    })}
                  </div>
                )}
                <input
                  value={cityQuery[key] ?? ""}
                  onChange={(e) => setCityQuery((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder="Type a city or province, then pick from the list"
                />
                {matches.length > 0 && (
                  <div className="picker">
                    {matches.map((c) => (
                      <button type="button" key={c.code}
                        disabled={chosen.has(c.code)}
                        onClick={() => {
                          patch(key, { city_codes: [...m.city_codes, c.code] });
                          setCityQuery((p) => ({ ...p, [key]: "" }));
                        }}>
                        <strong>{c.display_name}</strong>
                        <span className="small muted">{c.province_name || "—"}</span>
                      </button>
                    ))}
                  </div>
                )}
                {m.city_codes.length > 0 && cities.length > 0 && m.city_codes.every((c) => !cities.some((x) => x.code === c)) && (
                  <span className="small muted">Loading the city list…</span>
                )}
              </div>

              {!m.isNew && (
                <div className="field" style={{ marginTop: 16 }}>
                  <label>Weekly hours</label>
                  <p className="small muted" style={{ margin: "0 0 8px" }}>
                    Partners set these themselves from their portal. Read-only here so an accidental admin save
                    cannot quietly move a booked slot.
                  </p>
                  <div className="hoursgrid">
                    {DAYS.map((d, i) => {
                      const rs = (hours[m.id] ?? []).filter((r) => r.weekday === i);
                      return <div key={d} className="hoursgrid-row">
                        <strong>{d}</strong>
                        <span className="small muted">
                          {rs.length ? rs.map((r) => `${trim(r.start_time)}–${trim(r.end_time)}`).join(", ") : "Not working"}
                        </span>
                      </div>;
                    })}
                  </div>
                  {!!(timeOff[m.id] ?? []).length && (
                    <p className="small muted" style={{ marginTop: 8 }}>
                      Away: {(timeOff[m.id] ?? []).map((t) => t.on_date).sort().join(", ")}
                    </p>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
                <button className="btn" disabled={busy === key} style={{ minHeight: 42, opacity: busy === key ? 0.6 : 1 }} onClick={() => save(m)}>
                  {busy === key ? "SAVING…" : "SAVE PROFILE"}
                </button>
                {m.id && !m.isNew && (m.active
                  ? <button className="btn secondary" style={{ minHeight: 42 }} disabled={busy === key} onClick={() => deactivate(m)}>TAKE OFF MARKETPLACE</button>
                  : <button className="btn secondary" style={{ minHeight: 42 }} disabled={busy === key} onClick={() => reactivate(m)}>PUT BACK ON MARKETPLACE</button>)}
                {m.id && m.is_sample && (
                  <button className="btn secondary" style={{ minHeight: 42 }} disabled={busy === key} onClick={() => deleteSample(m)}>DELETE SAMPLE</button>
                )}
                {m.id && <button className="btn secondary" style={{ minHeight: 42 }} onClick={() => setOpen(null)}>CLOSE</button>}
              </div>
            </div>}
          </div>;
        })}
      </div>}
  </>;
}

const trim = (t: string) => t.slice(0, 5);

/** The fields a customer actually sees on a public profile. */
function completeness(m: Member, hasAgreement: boolean) {
  const checks = [
    !!m.name.trim(), !!m.headline.trim(), !!m.tagline.trim(),
    !!m.bio.trim(), !!m.photo_path,
    m.years_experience !== "" && Number(m.years_experience) > 0,
    !!m.phone.trim(), !!m.email.trim(),
    m.city_codes.length > 0, hasAgreement, !!m.slug,
  ];
  return { done: checks.filter(Boolean).length, total: checks.length };
}
