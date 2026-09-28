"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { PortalChrome } from "@/components/portal/PortalChrome";
import { PushRegistration } from "@/components/PushRegistration";
import { OfflineBanner, OfflineScreen, useOfflineFallback } from "@/components/portal/Offline";
import { isNative } from "@/lib/is-native";
import { cacheAge, readSnapshot, writeSnapshot } from "@/lib/portal-cache";
import { storedUserId } from "@/lib/session";
import { classify, isNetworkFailure, type IdentityResult } from "@/lib/portal-identity";
import { PortalIdentityScreen } from "@/components/portal/PortalIdentityScreen";

/** The columns my_assignments() is allowed to return. admin_notes is absent
 *  by design and never arrives over the wire. */
type Assignment = {
  assignment_id: string; status: string; note: string; member_note: string;
  assigned_at: string; responded_at: string | null; done_at: string | null;
  booking_id: string; booking_ref: string | null; names: string | null; phone: string | null;
  email: string | null; services: string | null; date: string | null; time: string | null;
  adress: string | null; city: string | null; province: string | null; landmark: string | null;
  access: string | null; property: string | null; sqm: string | null;
  bedrooms: number | null; bathrooms: number | null; areas: string | null;
  condition: string | null; scope_notes: string | null; materials: string | null;
  price: number | null; photo_path: string | null; booking_status: string; booking_created_at: string;
};
type Me = {
  id: string; name: string; email: string; phone: string;
  available: boolean; unavailable_note: string; portal_status: string; active: boolean;
};

/**
 * The client-side mirror of the server's allowed transitions, in
 * app/api/portal/assignment/route.ts. The two have to agree: if the UI offers a
 * move the server refuses, the partner sees an error for something the app
 * suggested. And if the UI hides a move the server allows, a job can get stuck.
 */
const NEXT: Record<string, { to: string; label: string }[]> = {
  pending: [
    { to: "accepted", label: "Accept job" },
    { to: "declined", label: "Decline" },
  ],
  accepted: [
    { to: "on_the_way", label: "Start travelling" },
    { to: "declined", label: "Cannot make it" },
  ],
  on_the_way: [{ to: "done", label: "Mark as done" }],
  done: [], declined: [], cancelled: [],
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for you", accepted: "Accepted", declined: "Declined",
  on_the_way: "On the way", done: "Done", cancelled: "Cancelled",
};

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};
const fmtWhen = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const money = (n: number) => `₱${Number(n).toLocaleString("en-PH")}`;

const NOTE_KEY = "malto-portal-notes-v1";

/** Notes survive a refresh. A partner typing on a phone and losing it to an
 *  accidental reload is the kind of small thing that makes an app feel cheap. */
function loadNotes(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(NOTE_KEY) || "{}") ?? {};
  } catch {
    return {};
  }
}

export default function PortalJobs() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [offline, setOffline] = useState(false);
  const [cachedAt, setCachedAt] = useState(0);
  const [identity, setIdentity] = useState<IdentityResult | null>(null);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 3200); };

  /**
   * Network first, cache second.
   *
   * getUser() deliberately has no offline branch. It calls the auth server, so
   * when there is no connection it fails, and a failure that looks like "no
   * user" would bounce a signed-in partner to the login page every time they
   * opened the app somewhere without signal. Instead the whole load falls back
   * to the last good snapshot, and the banner says so.
   *
   * A closed session is the one thing that is not offline. A banned partner's
   * token stops validating, getUser() throws, and telling them they have no
   * signal while they are standing in a client's hallway with full bars is
   * worse than useless: they will wait for a network that is already fine.
   */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const supabase = createClient();
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!userData?.user) {
        setOffline(true);
        return;
      }
      const user = userData.user;

      const [{ data: mine, error: mErr }, { data: isStaff }] = await Promise.all([
        supabase
          .from("team_members")
          .select("id,name,role,email,phone,available,unavailable_note,portal_status,active")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle(),
        supabase.rpc("is_admin"),
      ]);
      if (mErr) throw mErr;

      // Terminal states render a screen; they never redirect. That is the whole
      // point of the classifier: this used to redirect to /portal/login while
      // the middleware redirected back to /portal, and the two ran against each
      // other forever for anybody signed in with no partner row.
      const identity = classify({ hasSession: true, member: mine ?? null, isAdmin: isStaff === true });
      if (identity.identity === "staff" || identity.identity === "no-profile") {
        setIdentity(identity);
        setLoading(false);
        return;
      }
      setIdentity(null);

      if (!mine) { router.replace("/portal/login"); return; }
      setMe(mine as Me);
      setOffline(false);

      if ((mine as any).portal_status !== "approved") { setLoading(false); return; }

      const { data: list, error: aErr } = await supabase.rpc("my_assignments");
      if (aErr) throw aErr;
      const assignments = (list as Assignment[]) || [];
      setRows(assignments);

      // Only a successful read is cached, so the cache can never hold a list
      // that came from a failed or partial query.
      await writeSnapshot(user.id, {
        at: Date.now(),
        me: mine as unknown as Record<string, unknown>,
        assignments: assignments as unknown as Record<string, unknown>[],
        version: "1.0.1",
      });
    } catch (e: any) {
      if (!isNetworkFailure(e)) {
        // A session that stopped validating, or a query the database refused.
        // Shown the same way on purpose: presenting a cached job list to
        // somebody who can no longer sign in is the one case where guessing
        // wrong is harmful.
        router.replace("/portal/login");
        return;
      }
      const userId = storedUserId();
      const snap = userId ? await readSnapshot(userId) : null;
      if (snap) {
        setMe((snap.me as unknown as Me) ?? null);
        setRows((snap.assignments as unknown as Assignment[]) || []);
        setCachedAt(snap.at);
        setOffline(true);
      } else {
        setError("Could not reach MALTO, and there is nothing saved on this phone yet.");
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setNoteDraft(loadNotes());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Only meaningful in the app: a browser tab on a phone can just reload.
    if (!isNative()) return;
    const onOnline = () => void load(true);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NOTE_KEY, JSON.stringify(noteDraft));
  }, [noteDraft]);

  const respond = async (id: string, status: string) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch("/api/portal/assignment", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment_id: id, status, member_note: noteDraft[id] }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j.ok === false) throw new Error(j.error || "Could not save that.");
      flash(status === "accepted" ? "Job accepted. The MALTO team has been notified." : status === "done" ? "Marked as done. Thank you." : "Job declined.");
      await load(true);
    } catch (e: any) {
      setError(e?.message || "Could not save that.");
    } finally {
      setBusy(null);
    }
  };

  const saveAvailability = async (patch: { available: boolean; unavailable_note: string }) => {
    if (busy) return;
    setBusy("me");
    setError(null);
    try {
      // The filter has to be on id, not user_id: `me` is selected as
      // team_members.id, so matching that value against the user_id column found
      // no rows. Supabase reported no error, so the toggle silently did nothing
      // and showed "Availability updated" every time.
      const { error: err } = await createClient().from("team_members").update(patch).eq("id", (me as any)?.id);
      if (err) throw err;
      await load(true);
      flash("Availability updated.");
    } catch (err: any) {
      setError(err?.message || "Could not update your availability.");
    } finally {
      setBusy(null);
    }
  };

  const loadPhoto = async (bookingId: string) => {
    if (photos[bookingId]) return;
    try {
      const res = await fetch("/api/portal/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (j.url) setPhotos((p) => ({ ...p, [bookingId]: j.url }));
    } catch {
      // A missing photo is not worth an error banner.
    }
  };

  // A cancelled booking overrides the assignment: the admin withdrew the job,
  // so the member must not be prompted to accept it.
  const eff = (r: Assignment) => (r.booking_status === "Cancelled" ? "cancelled" : r.status);

  const { active, upcoming, history } = useMemo(() => {
    const isOpen = (r: Assignment) => {
      const s = eff(r);
      return s === "pending" || s === "accepted" || s === "on_the_way";
    };
    return {
      active: rows.filter(isOpen),
      upcoming: rows.filter((r) => !isOpen(r) && eff(r) !== "cancelled"),
      history: rows.filter((r) => ["done", "declined", "cancelled"].includes(eff(r))),
    };
  }, [rows]);

  const fallback = useOfflineFallback(false);

  /**
   * Staff and unlinked accounts get a real screen, not a redirect.
   *
   * This is where the loop used to live. Redirecting from here to
   * /portal/login, while the middleware redirected a signed-in user away from
   * /portal/login, meant the two never agreed on where to stop. Rendering a
   * terminal state cannot loop no matter what the middleware does.
   */
  if (identity && (identity.identity === "staff" || identity.identity === "no-profile")) {
    return <PortalIdentityScreen identity={identity} />;
  }

  if (loading && !rows.length && !offline) {
    return (
      <PortalChrome active="jobs">
        <p className="portal-lead" style={{ paddingTop: 24 }}>Loading your jobs…</p>
      </PortalChrome>
    );
  }

  if (me && me.portal_status !== "approved") {
    return (
      <PortalChrome active="jobs" name={me.name}>
        <h1 className="portal-title">Hi {me.name.split(" ")[0]}.</h1>
        <div className="portal-notice info">
          <strong>Your account is waiting for approval.</strong>
          <br />
          MALTO still needs to approve your account before any job shows up here. You do not need to do
          anything else.
        </div>
        <p className="portal-hint">Signed in as {me.email}</p>
      </PortalChrome>
    );
  }

  // Offline with nothing cached: there is no honest way to show a job list, so
  // this is a real screen rather than an empty list that looks like bad luck.
  if (offline && !rows.length && !cachedAt) {
    return (
      <PortalChrome active="jobs" name={me?.name}>
        <OfflineScreen at={0} busy={fallback.busy} onRetry={() => window.location.reload()} />
      </PortalChrome>
    );
  }

  const pendingCount = active.filter((r) => eff(r) === "pending").length;

  return (
    <PortalChrome active="jobs" name={me?.name}>
      <PushRegistration />
      {offline && cachedAt ? <OfflineBanner at={cachedAt} stale={Date.now() - cachedAt > 12 * 3600_000} /> : null}
      {!offline && isNative() ? <PushPrompt /> : null}

      <div className="portal-shell" style={{ padding: 0 }}>
        {error ? <div className="portal-notice error">{error}</div> : null}
        {notice ? <div className="portal-notice info">{notice}</div> : null}

        <h1 className="portal-title">
          {pendingCount > 0 ? `${pendingCount} job${pendingCount === 1 ? "" : "s"} waiting` : "Your jobs"}
        </h1>
        <p className="portal-lead">
          {active.length || upcoming.length
            ? `Last checked ${new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`
            : "Nothing assigned to you right now."}
        </p>

        {/* The job list comes before the settings panels. The old order put
            notification state and an availability toggle above the jobs, which
            pushed the only thing that needs an answer, ACCEPT JOB, roughly a
            screen down on a phone. */}
        {[...active, ...upcoming].length === 0 ? (
          <div className="portal-empty">
            <h3>No jobs yet</h3>
            <p>They appear here the moment MALTO assigns one, and you will get an alert on this phone.</p>
          </div>
        ) : (
          <div className="portal-joblist">
            {[...active, ...upcoming].map((r) => {
              const isOpen = open === r.assignment_id;
              const view = eff(r);
              const actions = NEXT[view] ?? [];
              const mapHref = r.adress
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([r.adress, r.city, r.province].filter(Boolean).join(", "))}`
                : "";
              return (
                <article className="portal-job" key={r.assignment_id}>
                  <button
                    className="portal-job-head"
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => {
                      setOpen(isOpen ? null : r.assignment_id);
                      if (!isOpen) void loadPhoto(r.booking_id);
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span className="portal-job-ref">{r.booking_ref || "Job"}</span>
                      <span className="portal-job-service">{r.services || "Cleaning"}</span>
                      <span className="portal-job-when">
                        {fmtDate(r.date)}{r.time ? ` · ${r.time}` : ""}
                      </span>
                    </span>
                    <span className={"badge" + (["pending", "accepted", "on_the_way"].includes(view) ? " on" : "")}>
                      {STATUS_LABEL[view] ?? view}
                    </span>
                  </button>

                  {isOpen ? (
                    <div className="portal-job-body">
                      {view === "cancelled" ? (
                        <div className="portal-notice error">This job was cancelled by MALTO. Nothing to do.</div>
                      ) : null}
                      {r.note ? (
                        <div className="portal-notice info">
                          <strong>Note from the team:</strong> {r.note}
                        </div>
                      ) : null}

                      <dl className="portal-facts">
                        <div>
                          <dt>Customer</dt>
                          <dd>{r.names || "—"}</dd>
                          {r.phone ? <dd><a href={`tel:${r.phone}`}>Call {r.phone}</a></dd> : null}
                          {r.email ? <dd><a href={`mailto:${r.email}`}>Email {r.email}</a></dd> : null}
                        </div>
                        <div>
                          <dt>Address</dt>
                          <dd>{[r.adress, r.city, r.province].filter(Boolean).join(", ") || "—"}</dd>
                          {r.landmark ? <dd className="portal-hint">Landmark: {r.landmark}</dd> : null}
                          {mapHref ? <dd><a href={mapHref} target="_blank" rel="noreferrer">Open in Maps</a></dd> : null}
                        </div>
                        <div>
                          <dt>Property</dt>
                          <dd>{r.property || "—"}</dd>
                          <dd className="portal-hint">
                            {[r.sqm ? `${r.sqm} sqm` : null, r.bedrooms ? `${r.bedrooms} bed` : null, r.bathrooms ? `${r.bathrooms} bath` : null]
                              .filter(Boolean).join(" · ")}
                          </dd>
                          {r.condition ? <dd className="portal-hint">Condition: {r.condition}</dd> : null}
                        </div>
                        <div>
                          <dt>Scope</dt>
                          <dd>{r.areas || "—"}</dd>
                          {r.materials ? <dd className="portal-hint">Materials: {r.materials}</dd> : null}
                          {r.scope_notes ? <dd className="portal-hint">{r.scope_notes}</dd> : null}
                        </div>
                        {r.access ? (
                          <div>
                            <dt>Access</dt>
                            <dd>{r.access}</dd>
                          </div>
                        ) : null}
                        {r.price != null ? (
                          <div>
                            <dt>Final price</dt>
                            <dd>{money(r.price)}</dd>
                          </div>
                        ) : null}
                      </dl>

                      {photos[r.booking_id] ? (
                        <img src={photos[r.booking_id]} alt="Customer photo of the property" className="portal-photo" />
                      ) : null}

                      <div className="portal-field">
                        <label htmlFor={`note-${r.assignment_id}`}>Your note (optional)</label>
                        <input
                          id={`note-${r.assignment_id}`}
                          className="portal-input"
                          value={noteDraft[r.assignment_id] ?? r.member_note}
                          onChange={(e) => setNoteDraft((p) => ({ ...p, [r.assignment_id]: e.target.value }))}
                          placeholder="e.g. I will bring my own vacuum"
                        />
                      </div>

                      {actions.length > 0 ? (
                        <div className="portal-jobactions">
                          {actions.map((a) => (
                            <button
                              key={a.to}
                              type="button"
                              className={"portal-btn" + (a.to === "declined" ? " secondary" : "")}
                              disabled={busy === r.assignment_id || offline}
                              onClick={() => respond(r.assignment_id, a.to)}
                            >
                              {busy === r.assignment_id ? "Saving…" : a.label}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <p className="portal-hint">
                        Assigned {fmtWhen(r.assigned_at)}
                        {r.responded_at ? ` · Answered ${fmtWhen(r.responded_at)}` : ""}
                        {r.done_at ? ` · Done ${fmtWhen(r.done_at)}` : ""}
                      </p>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}

        {/* Availability: the single most useful thing for a part-time crew, and
            what stops the admin assigning a job while you are unavailable. */}
        <div className="portal-panel" style={{ marginTop: 20 }}>
          <div className="portal-panel-head">
            <strong>Your availability</strong>
            <span className={"badge" + (me?.available ? " on" : "")}>{me?.available ? "Available" : "Unavailable"}</span>
          </div>
          <p className="portal-hint" style={{ marginBottom: 12 }}>
            {me?.available
              ? "You are listed as available and can be assigned jobs."
              : "You will not appear as assignable while this is on."}
          </p>
          <div className="portal-btn-row">
            <button
              type="button"
              className="portal-btn"
              disabled={busy === "me" || me?.available || offline}
              onClick={() => saveAvailability({ available: true, unavailable_note: me?.unavailable_note || "" })}
            >
              I&apos;m available
            </button>
            <button
              type="button"
              className="portal-btn secondary"
              disabled={busy === "me" || !me?.available || offline}
              onClick={() => saveAvailability({ available: false, unavailable_note: me?.unavailable_note || "Unavailable" })}
            >
              I&apos;m unavailable
            </button>
          </div>
          {me && !me.available ? (
            <div className="portal-field" style={{ marginTop: 14, marginBottom: 0 }}>
              <label htmlFor="unavailable-note">Reason (optional)</label>
              <input
                id="unavailable-note"
                className="portal-input"
                defaultValue={me.unavailable_note}
                placeholder="Sick, other job, etc."
                onBlur={(e) => {
                  if (e.target.value !== me.unavailable_note) {
                    void saveAvailability({ available: false, unavailable_note: e.target.value });
                  }
                }}
              />
            </div>
          ) : null}
        </div>

        {/* Past jobs were a four column table inside overflow:auto, which on a
            phone is a horizontal scroll with no affordance telling you it is
            there. Cards work at every width. */}
        {history.length > 0 ? (
          <>
            <h2 className="portal-title" style={{ fontSize: 18, marginTop: 28 }}>Past jobs</h2>
            <div className="portal-joblist">
              {history.map((r) => (
                <div className="portal-job" key={r.assignment_id} style={{ padding: "var(--s3) var(--s4)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="portal-job-ref">{r.booking_ref}</div>
                      <div style={{ fontSize: 15 }}>{r.services}</div>
                      <div className="portal-hint">{fmtDate(r.date)}</div>
                    </div>
                    <span className="badge">{STATUS_LABEL[eff(r)] ?? eff(r)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </PortalChrome>
  );
}

/**
 * Only shown inside the app, and only if the device token has not been stored.
 * In a browser this whole block is absent, because push there is web push and is
 * handled by the old panel further down the portal.
 */
function PushPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Give the registration component a moment to succeed before telling the
    // partner about it, so a person who already granted permission is not asked
    // about something that is already on.
    const t = setTimeout(() => {
      try {
        const cap = (window as any).Capacitor;
        if (!cap?.isNativePlatform?.()) return;
        const Push = (window as any).PushNotificationsPlugin;
        void (async () => {
          try {
            const status = await Push?.checkPermissions?.();
            setShow(status?.receive !== "granted");
          } catch {
            /* nothing to say */
          }
        })();
      } catch {
        /* nothing to say */
      }
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;
  return (
    <div className="portal-panel portal-panel-accent">
      <div className="portal-panel-head"><strong>Job alerts</strong></div>
      <p className="portal-hint" style={{ marginBottom: 12 }}>
        Turn on alerts and you will hear a chime the moment MALTO assigns you a job, instead of having to
        open this app.
      </p>
      <button
        type="button"
        className="portal-btn block"
        onClick={async () => {
          try {
            const Push = (await import("@capacitor/push-notifications")).PushNotifications;
            let p = await Push.checkPermissions();
            if (p.receive === "prompt") p = await Push.requestPermissions();
            setShow(p.receive !== "granted");
          } catch {
            setShow(false);
          }
        }}
      >
        Turn on job alerts
      </button>
      <p className="portal-hint" style={{ marginTop: 10 }}>
        Blocked in your phone settings? Android, then Apps, then MALTO Partner, then Notifications.
      </p>
    </div>
  );
}
