"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { PortalChrome } from "@/components/portal/PortalChrome";
import { IDENTITY_COPY, type IdentityResult } from "@/lib/portal-identity";

/**
 * The two states that end a session rather than sending it somewhere else.
 *
 * Staff, and an account with no partner profile. Both used to bounce, and the
 * bounce was the bug: the portal redirected to the login page, the middleware
 * redirected the login page back, and neither ever yielded. This screen has no
 * way out except a deliberate one, so no combination of routes can trap anybody
 * in a loop.
 *
 * The sign-out is a button and not a link, on purpose. A link would leave a
 * signed-in session behind, and the whole reason somebody is looking at this
 * screen is that the session leads nowhere.
 */
export function PortalIdentityScreen({ identity }: { identity: IdentityResult }) {
  const router = useRouter();
  const copy = IDENTITY_COPY[identity.identity as "staff" | "no-profile"];

  const signOut = async () => {
    try {
      await createClient().auth.signOut();
    } catch {
      // Even if this fails, moving on clears what the browser shows. A session
      // that outlives the screen is not what either of these states is about.
    }
    router.replace("/portal/login");
    router.refresh();
  };

  return (
    <PortalChrome active="jobs" name={identity.name}>
      <div className="portal-empty" style={{ marginTop: 24 }}>
        <h3>{copy.title}</h3>
        <p>{copy.body}</p>
        <div className="portal-btn-row" style={{ marginTop: 22, justifyContent: "center" }}>
          {identity.identity === "staff" ? (
            <Link className="portal-btn" href="/admin/login" style={{ marginBottom: 0 }}>
              Staff sign-in
            </Link>
          ) : null}
          <button className="portal-btn secondary" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </PortalChrome>
  );
}
