"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { PortalChrome } from "@/components/portal/PortalChrome";
import { storedUserId } from "@/lib/session";
import { isValidEmail } from "@/lib/email";

/**
 * The partner's own profile: photo, details, where they work, what they take.
 *
 * None of this existed before. A partner could set a headline once during
 * registration and never again, could not correct a phone number that had
 * changed, and could not replace the photo an admin had uploaded years ago. The
 * public profile is the thing that gets them work, so a stale one is a lost
 * booking rather than a cosmetic problem.
 *
 * Saves go through PATCH/PUT on /api/portal/profile rather than updating
 * directly, because the database's own policy lets a partner write any column of
 * their row except two. The allowlist is on the server.
 */

type City = { code: string; display_name: string; province_name: string | null };
type Service = { id: string; name: string; active: boolean };
type Profile = {
  id: string; name: string; phone: string; email: string;
  headline: string; tagline: string; bio: string;
  years_experience: number | null; photo_path: string | null; portal_status: string;
};

const PHOTO_BUCKET = "team-photos";
const MAX_PHOTO = 5 * 1024 * 1024;

export default function PortalProfile() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [myAreas, setMyAreas] = useState<string[]>([]);
  const [myServices, setMyServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Password rotation. Present because the admin's "Create account" hands out a
  // generated password, and a credential a partner cannot change is one that
  // stays with whoever overheard it.
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwField, setPwField] = useState<string | null>(null);

  const changePassword = async () => {
    if (pwBusy) return;
    setPwBusy(true); setPwError(null); setPwField(null);
    try {
      const res = await fetch("/api/portal/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pw),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j.ok === false) { setPwField(j.field ?? null); throw new Error(j.error || "Could not change your password."); }
      setPw({ current: "", next: "", confirm: "" });
      flash("Password changed.");
    } catch (e: any) {
      setPwError(e?.message || "Could not change your password.");
    } finally { setPwBusy(false); }
  };

  // The editable draft. Kept separate from `me` so a half-typed headline is
  // never pushed into the cached snapshot or shown as saved.
  const [draft, setDraft] = useState({
    name: "", phone: "", headline: "", tagline: "", bio: "", years_experience: "",
  });

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 3200); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userData?.user) { router.replace("/portal/login"); return; }
      const userId = userData.user.id;

      const [mine, cityRes, serviceRes, areaRes, myServiceRes] = await Promise.all([
        supabase.from("team_members")
          .select("id,name,phone,email,headline,tagline,bio,years_experience,photo_path,portal_status")
          .eq("user_id", userId).limit(1).maybeSingle(),
        supabase.from("cities").select("code,display_name,province_name").order("display_name").limit(2000),
        supabase.from("services").select("id,name,active").eq("active", true).order("name"),
        supabase.from("partner_areas").select("city_code").eq("partner_id", userId),
        supabase.from("partner_services").select("service_id").eq("partner_id", userId),
      ]);

      if (mine.error) throw mine.error;
      if (!mine.data) { router.replace("/portal/login"); return; }
      setMe(mine.data as Profile);
      setDraft({
        name: mine.data.name ?? "",
        phone: mine.data.phone ?? "",
        headline: mine.data.headline ?? "",
        tagline: mine.data.tagline ?? "",
        bio: mine.data.bio ?? "",
        years_experience: mine.data.years_experience != null ? String(mine.data.years_experience) : "",
      });

      setCities((cityRes.data as City[]) ?? []);
      setServices((serviceRes.data as Service[]) ?? []);
      setMyAreas(((areaRes.data as any[]) ?? []).map((r) => r.city_code));
      setMyServices(((myServiceRes.data as any[]) ?? []).map((r) => r.service_id));

      // The bucket is public, so the photo is a plain URL. A signed URL would
      // expire and leave a broken image on the one screen where somebody is
      // deciding whether their own profile looks right.
      if (mine.data.photo_path) {
        setPhotoUrl(supabase.storage.from(PHOTO_BUCKET).getPublicUrl(mine.data.photo_path).data.publicUrl);
      }
    } catch (e: any) {
      setError(e?.message || "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const saveDetails = async () => {
    if (busy) return;
    setBusy("details");
    setError(null);
    setField(null);
    try {
      if (!draft.name.trim()) {
        setField("name");
        throw new Error("Your name cannot be empty.");
      }
      const res = await fetch("/api/portal/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          phone: draft.phone,
          headline: draft.headline,
          tagline: draft.tagline,
          bio: draft.bio,
          years_experience: draft.years_experience === "" ? 0 : Number(draft.years_experience),
        }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j.ok === false) {
        setField(j.field ?? null);
        throw new Error(j.error || "Could not save your details.");
      }
      await load();
      flash("Details saved. Your public profile has been updated.");
    } catch (e: any) {
      setError(e?.message || "Could not save your details.");
    } finally {
      setBusy(null);
    }
  };

  const uploadPhoto = async (file: File) => {
    if (busy) return;
    if (!file.type.startsWith("image/")) { setError("Choose an image file."); return; }
    if (file.size > MAX_PHOTO) {
      setError(`That photo is ${(file.size / 1048576).toFixed(1)}MB. The limit is 5MB.`);
      return;
    }
    setBusy("photo");
    setError(null);
    try {
      // The path is derived from the partner's own id on the server, so there is
      // nothing here to choose and nothing for a client to point elsewhere.
      const body = new FormData();
      body.append("photo", file);
      const res = await fetch("/api/portal/profile/photo", { method: "POST", body });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j.ok === false) throw new Error(j.error || "Could not update your photo.");

      if (j.url) setPhotoUrl(j.url);
      setMe((m) => (m ? { ...m, photo_path: j.photo_path } : m));
      flash("Photo updated.");
    } catch (e: any) {
      setError(e?.message || "Could not update your photo.");
    } finally {
      setBusy(null);
    }
  };

  const saveCoverage = async () => {
    if (busy) return;
    setBusy("coverage");
    setError(null);
    setField(null);
    try {
      const res = await fetch("/api/portal/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city_codes: myAreas, service_ids: myServices }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j.ok === false) {
        setField(j.field ?? null);
        throw new Error(j.error || "Could not save your coverage.");
      }
      flash("Coverage saved. Clients can now book you in those places.");
    } catch (e: any) {
      setError(e?.message || "Could not save your coverage.");
    } finally {
      setBusy(null);
    }
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return cities
      .filter((c) => !myAreas.includes(c.code))
      .filter((c) => c.display_name.toLowerCase().includes(q) || (c.province_name ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [cities, myAreas, query]);

  const chosen = useMemo(
    () => myAreas.map((code) => cities.find((c) => c.code === code)).filter(Boolean) as City[],
    [myAreas, cities]
  );

  if (loading) {
    return <PortalChrome active="profile"><p className="portal-lead" style={{ paddingTop: 24 }}>Loading your profile…</p></PortalChrome>;
  }

  return (
    <PortalChrome active="profile" name={me?.name}>
      <div style={{ padding: 0 }}>
        {error ? <div className="portal-notice error">{error}</div> : null}
        {notice ? <div className="portal-notice info">{notice}</div> : null}

        <h1 className="portal-title">Your profile</h1>
        <p className="portal-lead">This is what a client sees when they find you.</p>

        {/* Photo */}
        <div className="portal-panel">
          <div className="portal-panel-head"><strong>Photo</strong></div>
          <div className="portal-photo-picker">
            {photoUrl ? (
              <img className="portal-photo-current" src={photoUrl} alt="Your profile photo" />
            ) : (
              <div className="portal-photo-empty" aria-hidden="true">
                {(me?.name || "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              {/* A label wrapping a hidden input rather than a styled button:
                  it is the only way to get the system camera and gallery on a
                  phone, and it keeps the native picker for what it is good at. */}
              <label className="portal-btn secondary" style={{ marginBottom: 0 }}>
                {busy === "photo" ? "Uploading…" : photoUrl ? "Replace photo" : "Add a photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="visually-hidden-input"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadPhoto(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <p className="portal-hint" style={{ marginTop: 8 }}>JPG or PNG, up to 5MB.</p>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="portal-panel">
          <div className="portal-panel-head"><strong>About you</strong></div>

          <div className="portal-field">
            <label htmlFor="p-name">Full name</label>
            <input
              id="p-name"
              className="portal-input"
              autoComplete="name"
              value={draft.name}
              aria-invalid={field === "name"}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
            {field === "name" ? <p className="portal-hint">Your name cannot be empty.</p> : null}
          </div>

          <div className="portal-field">
            <label htmlFor="p-phone">Phone</label>
            <input
              id="p-phone"
              className="portal-input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="09xx xxx xxxx"
              value={draft.phone}
              aria-invalid={field === "phone"}
              onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
            />
            <p className="portal-hint">This is how a client reaches you on the way to a job.</p>
          </div>

          <div className="portal-field">
            <label htmlFor="p-headline">Headline</label>
            <input
              id="p-headline"
              className="portal-input"
              placeholder="e.g. Deep cleaning specialist"
              value={draft.headline}
              onChange={(e) => setDraft((d) => ({ ...d, headline: e.target.value }))}
            />
          </div>

          <div className="portal-field">
            <label htmlFor="p-tagline">Short tagline</label>
            <input
              id="p-tagline"
              className="portal-input"
              placeholder="One line clients see under your name"
              value={draft.tagline}
              onChange={(e) => setDraft((d) => ({ ...d, tagline: e.target.value }))}
            />
          </div>

          <div className="portal-field">
            <label htmlFor="p-years">Years of experience</label>
            <input
              id="p-years"
              className="portal-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={70}
              value={draft.years_experience}
              onChange={(e) => setDraft((d) => ({ ...d, years_experience: e.target.value }))}
            />
          </div>

          <div className="portal-field">
            <label htmlFor="p-bio">About you</label>
            <textarea
              id="p-bio"
              className="portal-textarea"
              placeholder="What you specialise in, what a client can expect, anything you want them to know before booking."
              value={draft.bio}
              onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
            />
          </div>

          <div className="portal-field">
            <label>Email</label>
            <input className="portal-input" value={me?.email ?? ""} readOnly disabled />
            <p className="portal-hint">
              Your sign-in address. Ask MALTO to change it if you need a different one.
            </p>
          </div>

          <button className="portal-btn block" type="button" disabled={busy === "details"} onClick={saveDetails}>
            {busy === "details" ? "Saving…" : "Save details"}
          </button>
        </div>

        {/* Password. Verified against the current one on the server, so a phone
            left unlocked on a job cannot be used to lock the owner out. */}
        <div className="portal-panel">
          <div className="portal-panel-head"><strong>Password</strong></div>
          {pwError ? <div className="portal-notice error">{pwError}</div> : null}
          <div className="portal-field">
            <label htmlFor="pw-current">Current password</label>
            <input
              id="pw-current"
              className="portal-input"
              type="password"
              autoComplete="current-password"
              value={pw.current}
              aria-invalid={pwField === "current"}
              onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
            />
          </div>
          <div className="portal-field">
            <label htmlFor="pw-next">New password</label>
            <input
              id="pw-next"
              className="portal-input"
              type="password"
              autoComplete="new-password"
              value={pw.next}
              aria-invalid={pwField === "next"}
              onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
            />
            <p className="portal-hint">At least 8 characters.</p>
          </div>
          <div className="portal-field">
            <label htmlFor="pw-confirm">Repeat the new password</label>
            <input
              id="pw-confirm"
              className="portal-input"
              type="password"
              autoComplete="new-password"
              value={pw.confirm}
              aria-invalid={pwField === "confirm"}
              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
            />
          </div>
          <button
            className="portal-btn block"
            type="button"
            disabled={pwBusy}
            onClick={changePassword}
          >
            {pwBusy ? "Changing…" : "Change password"}
          </button>
        </div>

        {/* Coverage */}
        <div className="portal-panel">
          <div className="portal-panel-head">
            <strong>Where you work</strong>
            <span className="badge">{myAreas.length} place{myAreas.length === 1 ? "" : "s"}</span>
          </div>

          {chosen.length > 0 ? (
            <div className="portal-chips" style={{ marginBottom: 12 }}>
              {chosen.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  className="portal-chip on"
                  onClick={() => setMyAreas((a) => a.filter((x) => x !== c.code))}
                >
                  {c.display_name} ×
                </button>
              ))}
            </div>
          ) : (
            <p className="portal-hint" style={{ marginBottom: 12 }}>
              No places yet. Add at least one so clients can find you.
            </p>
          )}

          <div className="portal-picker">
            <input
              className="portal-input"
              placeholder="Search for a city or municipality"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
              onFocus={() => setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 180)}
            />
            {showResults && results.length > 0 ? (
              <div className="portal-results">
                {results.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setMyAreas((a) => [...a, c.code]);
                      setQuery("");
                      setShowResults(false);
                    }}
                  >
                    {c.display_name}
                    <small>{c.province_name}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <p className="portal-hint" style={{ margin: "12px 0 16px" }}>
            Removing a place does not cancel a job you have already accepted. If you cannot travel somewhere,
            switch yourself to unavailable instead.
          </p>

          <div className="portal-panel-head"><strong>Services you take</strong></div>
          <div className="portal-chooserow">
            {services.map((s) => {
              const on = myServices.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={"portal-choosecard" + (on ? " on" : "")}
                  aria-pressed={on}
                  onClick={() =>
                    setMyServices((list) => (on ? list.filter((x) => x !== s.id) : [...list, s.id]))
                  }
                >
                  <span>{s.name}</span>
                  {on ? <span className="tick" aria-hidden="true">✓</span> : null}
                </button>
              );
            })}
          </div>

          <div className="portal-btn-row" style={{ marginTop: 20 }}>
            <button className="portal-btn" type="button" disabled={busy === "coverage"} onClick={saveCoverage}>
              {busy === "coverage" ? "Saving…" : "Save coverage"}
            </button>
          </div>
        </div>
      </div>
    </PortalChrome>
  );
}
