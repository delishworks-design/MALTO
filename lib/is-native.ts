/**
 * Is this page running inside the Android app?
 *
 * One definition, because four separate components need this answer and they
 * must not disagree. When the version gate first shipped it carried its own
 * copy of this check inline, and a second one for the portal fence would have
 * been a third. Two of them drifting is enough to end up with the app showing
 * the marketing site to a cleaner, which is the exact failure the fences exist
 * to prevent.
 *
 * Reads the global rather than importing Capacitor. This module is bundled into
 * the website too, where pulling in the native plugins is dead weight and
 * would try to reach a bridge that is not there.
 */

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }
}

/**
 * False in a browser, including an iPhone on the website.
 *
 * Note this is a runtime check, so it must not run during server rendering:
 * there is no `window` there. The first paint of any component gated on this
 * will therefore be the ungated one, which is why the callers start in an
 * undecided state rather than defaulting to false.
 */
export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = window.Capacitor;
  return typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : false;
}

/** "android" | "ios" | "web", or "web" when the bridge is missing. */
export function platform(): string {
  if (typeof window === "undefined") return "web";
  const cap = window.Capacitor;
  return typeof cap?.getPlatform === "function" ? cap.getPlatform() : "web";
}

/**
 * The only routes the app is allowed to show.
 *
 * A partner using the app should never land on the marketing site: not from the
 * logo, not from a stray link, not from history. Three paths is all the product
 * needs, and anything else in the WebView is a bug rather than a destination.
 */
export const APP_PATHS = ["/portal", "/portal/login", "/portal/register"] as const;

/**
 * Whether a pathname belongs in the app.
 *
 * Prefix matching on purpose, so /portal/login and /portal/register are
 * covered without listing every future sub-route, but /portalX is not: a
 * prefix without the trailing slash would let /portalanything through.
 */
export function isAppPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return APP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
