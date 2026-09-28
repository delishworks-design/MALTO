"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { cacheAge, isStale, readSnapshot } from "@/lib/portal-cache";
import { storedUserId } from "@/lib/session";

/**
 * Says plainly that what is on screen is not live, and hides the app behind an
 * offline screen when there is nothing to show.
 *
 * The wording is the point. "Something went wrong" and a spinner teach a
 * partner nothing about whether the job they are looking at is still theirs, so
 * this says which list it is, how old it is, and that accepting is off until
 * the signal comes back. It is also not dismissible: a cleaner who swipes past
 * a warning and accepts a stale job is the exact failure the cache-only
 * decision was made to prevent.
 *
 * Nothing is rendered while online, and nothing is fetched on mount beyond the
 * cache lookup, so this costs one IndexedDB read.
 */
export function useOfflineFallback(enabled: boolean) {
  const [state, setState] = useState<{ at: number; hasJobs: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // Only meaningful while the app is running without a usable connection.
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator !== "undefined" && navigator.onLine) {
      setState(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // Deliberately not getUser(): that calls the auth server, which is exactly
      // what is unavailable, so a signed-in partner would be bounced to the
      // login page by the page's own redirect. The session is in local storage
      // and the cache is keyed by whatever id was stored with it.
      const userId = storedUserId();
      if (!userId || cancelled) {
        setState({ at: Date.now(), hasJobs: false });
        return;
      }
      const snap = await readSnapshot(userId);
      if (cancelled) return;
      setState({ at: snap?.at ?? 0, hasJobs: (snap?.assignments?.length ?? 0) > 0 });
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const retry = async () => {
    setBusy(true);
    try {
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return { offline: state, retry, busy, stale: state ? isStale(state.at) : false, age: state?.at ? cacheAge(state.at) : null };
}


export function OfflineBanner({ at, stale }: { at: number; stale: boolean }) {
  return (
    <div className="portal-offline" role="status">
      <div>
        <strong>You are offline.</strong>
        {stale
          ? " This list is too old to rely on. Wait for a connection before you act on it."
          : ` Showing the last list saved on this phone, ${cacheAge(at)}. You cannot accept, decline or change anything until the signal is back.`}
      </div>
    </div>
  );
}

export function OfflineScreen({ at, busy, onRetry }: { at: number; busy: boolean; onRetry: () => void }) {
  const router = useRouter();
  return (
    <div className="portal-shell">
      <div className="portal-empty" style={{ marginTop: 24 }}>
        <h3>No connection</h3>
        <p>
          There is nothing saved on this phone to show yet, and the signal is not back. The app needs a
          connection the first time you open it.
        </p>
        <div className="portal-btn-row" style={{ marginTop: 20, justifyContent: "center" }}>
          <button className="portal-btn" onClick={onRetry} disabled={busy} type="button">
            {busy ? "Trying…" : "Try again"}
          </button>
          <button
            className="portal-btn secondary"
            type="button"
            onClick={() => {
              createClient().auth.signOut().finally(() => router.replace("/portal/login"));
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
