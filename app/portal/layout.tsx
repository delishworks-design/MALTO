import type { Viewport } from "next";
import type { ReactNode } from "react";
import "./portal-mobile.css";

/**
 * The portal is the product for a partner holding a phone, so it gets its own
 * layout for the two things that cannot be set from inside a page: the viewport,
 * and a safe area.
 *
 * viewportFit: "cover" is the part that matters. Without it the notch, the
 * status bar and the home indicator are simply excluded from the layout, and
 * env(safe-area-inset-*) resolves to zero, which means a sticky header sits
 * under a notch and a fixed tab bar sits behind a home indicator. On a phone
 * held in one hand that is not a cosmetic problem, it is content you cannot
 * read.
 *
 * The tab bar is fixed to the bottom rather than pinned in flow because it must
 * stay reachable with a thumb; a tab bar that scrolls away is not a tab bar.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // No maximumScale. Pinching to zoom is an accessibility feature and blocking
  // it is a WCAG failure, and there is nothing to protect here: the portal is
  // text and buttons, not a canvas or a map.
  maximumScale: 5,
  themeColor: "#FBFAF7",
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div className="portal-app">{children}</div>;
}
