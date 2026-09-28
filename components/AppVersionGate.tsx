"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/lib/is-native";

/**
 * Blocks the app when the installed build is too old to keep using.
 *
 * A sideloaded app has no store to force an update, so nothing else will ever
 * tell a cleaner their build is stale. Without this, a bug fixed in 1.0.1 stays
 * broken on every phone that installed 1.0.0 and nobody notices, because the
 * website is the same in both.
 *
 * No-ops entirely in a browser. The portal is the same page whether it is
 * opened in Safari or in the app's WebView, and a browser visitor has no build
 * to update, so the check only runs when Capacitor says it is native.
 *
 * It fails open on purpose. Every failure mode here, no network, the endpoint
 * down, an unparseable answer, ends with the portal working, because a cleaner
 * locked out of their own bookings over a failed version check is a far worse
 * outcome than one still on an old build.
 */

type Verdict = { ok: boolean; reason: string; min: string; latest: string; url: string };

// Kept in step with the build's versionName. If these drift the check compares
// against the wrong number, so the build is what changes and not this.
const APP_VERSION = "1.0.1";

export function AppVersionGate() {
  const [blocked, setBlocked] = useState<Verdict | null>(null);

  useEffect(() => {
    if (!isNative()) return;

    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(`/api/app/version?version=${encodeURIComponent(APP_VERSION)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const v = (await res.json()) as Verdict;
        if (!cancelled && v && v.ok === false) setBlocked(v);
      } catch {
        /* offline or endpoint down: stay open */
      }
    };

    check();

    // Re-check whenever the app comes back to the foreground. A cleaner who
    // left the app open overnight should be told on return, not on next launch.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!blocked) return null;

  const href = blocked.url
    ? `${blocked.url}${blocked.url.includes("?") ? "&" : "?"}download=malto-partner.apk`
    : null;

  return (
    <div className="version-gate" role="alertdialog" aria-modal="true" aria-labelledby="vg-title">
      <div className="version-gate-card">
        <h2 id="vg-title">This version needs updating</h2>
        <p>
          You are on {APP_VERSION} and version {blocked.min} is now the minimum. Update the app to keep
          seeing your bookings.
        </p>
        {href ? (
          <a className="btn" href={href} rel="noopener">
            Download the update
          </a>
        ) : (
          <p className="small muted">
            The download link is not available right now. Ask MALTO for the latest build.
          </p>
        )}
        <p className="small muted">
          You will stay signed in afterwards. Nothing you have entered is lost.
        </p>
      </div>
    </div>
  );
}
