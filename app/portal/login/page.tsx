"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { isNative } from "@/lib/is-native";

/**
 * Partner sign-in.
 *
 * Three things happen here that a plain form does not do, and each of them
 * exists because of a specific failure.
 *
 * Staff are refused. A staff account is not a partner, and letting one into the
 * app put the marketing-style shell in front of somebody managing bookings. The
 * session is closed again immediately, so the refusal costs one round trip
 * rather than leaving a signed-in staff account sitting in the portal.
 *
 * A rejected partner is told so. Their login is banned rather than deleted, so
 * Supabase answers a wrong password and there is nothing on the sign-in form
 * that distinguishes them from somebody who mistyped. Asking the server whether
 * that address is a rejected registration is the only way to tell them, and it
 * is asked only after a failed attempt.
 *
 * A pending partner gets in, and stays in. They see a waiting screen rather than
 * a login form, which is the difference between "something is happening" and
 * "I am doing this wrong".
 */
export default function PortalLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // In the app, the logo goes back to the portal and there is no way out to the
  // marketing site: the fence treats it as a dead end and pulls them back. In a
  // browser, "Back to website" is a genuine escape hatch for someone who
  // followed a link to the wrong place.
  const [native, setNative] = useState(false);
  useEffect(() => { setNative(isNative()); }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    const address = email.trim();
    try {
      const supabase = createClient();
      const { error: err } = await supabase.auth.signInWithPassword({ email: address, password });
      if (err) {
        if (/invalid login credentials/i.test(err.message)) {
          setError("Incorrect email or password.");
          // Only now, after a failed attempt, is it worth asking whether this
          // address is one we closed. Asking on a blank form would turn the page
          // into a way to test whether somebody is a partner.
          await showRejectionIfAny(address);
        } else {
          setError(err.message);
        }
        return;
      }

      // Signed in. Find out whether this account belongs to staff, because a
      // staff account has no business in the partner app.
      const { data: isStaff } = await supabase.rpc("is_admin");
      if (isStaff === true) {
        await supabase.auth.signOut();
        setError("This is the partner app. Staff sign in on the admin site.");
        setNotice("ADMIN");
        return;
      }

      router.push("/portal");
      router.refresh();
    } catch {
      setError("Could not reach the sign-in service. Please try again.");
    } finally { setBusy(false); }
  };

  const showRejectionIfAny = async (address: string) => {
    if (!address) return;
    try {
      const res = await fetch("/api/portal/login-notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address }),
      });
      if (!res.ok) return;
      const j = await res.json().catch(() => null);
      if (j?.rejected) {
        setNotice("Your registration was not approved. Please contact MALTO if you think that is a mistake.");
      }
    } catch {
      // A lookup that fails is not a reason to show a worse message than the
      // one they already have.
    }
  };

  const staffRefused = notice === "ADMIN";

  return <main className="portal-page">
    <header className="header"><div className="container nav">
      <Link href={native ? "/portal" : "/"} className="logo">MALTO<small>CLEANING SERVICES</small></Link>
      {native
        ? <span className="small muted">Partner app</span>
        : <Link className="small" href="/">Back to website</Link>}
    </div></header>

    <div className="portal-shell">
      <div className="eyebrow">TEAM PORTAL</div>
      <h2>Sign in.</h2>
      <p className="lead">Your assigned cleaning jobs appear here.</p>

      <form onSubmit={signIn} style={{ marginTop: 26 }}>
        <div className="form-grid">
          <div className="field full"><label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              placeholder="you@gmail.com"
            />
          </div>
          <div className="field full"><label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
        </div>

        {error && <div className="notice" style={{ background: "#FBE9E7", color: "#8A2C1D" }}>{error}</div>}
        {staffRefused && (
          <div className="notice">
            <Link href="/admin/login" style={{ textDecoration: "underline" }}>Go to the staff sign-in</Link>
          </div>
        )}
        {notice && notice !== "ADMIN" && (
          <div className="notice" style={{ background: "#FDF6E4", color: "#6B4E14" }}>{notice}</div>
        )}

        <div className="booking-actions">
          <span />
          <button className="btn" disabled={busy} style={{ opacity: busy ? .6 : 1 }}>
            {busy ? "SIGNING IN…" : "SIGN IN"}
          </button>
        </div>
      </form>

      {native ? (
        <p className="small muted" style={{ marginTop: 24 }}>
          No account yet? <Link href="/portal/register" style={{ textDecoration: "underline" }}>Create one here</Link>.
        </p>
      ) : (
        <p className="small muted" style={{ marginTop: 24 }}>
          No account yet? Partner registration is done in the app.{" "}
          <Link href="/join#join" style={{ textDecoration: "underline" }}>Get the partner app</Link>.
        </p>
      )}
    </div>
  </main>;
}
