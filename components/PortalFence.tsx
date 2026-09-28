"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isAppPath, isNative } from "@/lib/is-native";

/**
 * Keeps the app from ever showing the public website.
 *
 * The native shell already refuses to load a non-portal URL, but that is not
 * enough on its own, and the reason is worth stating: a Next.js <Link> is a
 * history.pushState, not a document load. shouldOverrideUrlLoading only sees
 * real navigations, so a cleaner tapping the portal's logo would push / onto
 * the WebView's history and the native guard would never fire. The marketing
 * site would simply appear, inside the app, with no way back.
 *
 * So this closes the gap from the other side. It watches the route on every
 * client navigation, and anything outside the three portal paths is replaced
 * with /portal.
 *
 * A full document replace rather than a router.push, deliberately. There is
 * usually nothing to do here at all once the links are fixed, and when there is
 * something to do a hard load guarantees no frame of the wrong page is ever
 * painted.
 */
export function PortalFence() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isNative()) return;
    if (isAppPath(pathname)) return;
    // Not a router.replace: see above. A full load also resets the WebView to
    // the entry page, so a half-rendered wrong route is discarded rather than
    // left behind in history.
    if (typeof window !== "undefined") window.location.replace("/portal");
  }, [pathname, router]);

  return null;
}
