"use client";

import { useRouter } from "next/navigation";
import { Briefcase, Clock, User } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import type { ReactNode } from "react";

/**
 * The frame every portal screen sits in: a compact sticky bar, the page, and a
 * fixed tab bar.
 *
 * The tab bar is the point of this being a component rather than a header in
 * each page. A cleaner standing in a client's hallway needs their jobs one tap
 * away and their profile one tap away; scrolling to a menu at the top of a page
 * to find out why they have no jobs is not an app.
 *
 * Fixed to the bottom because that is where a thumb is, and the pages carry
 * .portal-tabbar-space at the end so nothing ends up underneath it.
 */

export type PortalTab = "jobs" | "profile" | "hours";

const TABS: { id: PortalTab; label: string; href: string; Icon: typeof Briefcase }[] = [
  { id: "jobs", label: "Jobs", href: "/portal", Icon: Briefcase },
  { id: "profile", label: "Profile", href: "/portal/profile", Icon: User },
  { id: "hours", label: "Hours", href: "/portal/hours", Icon: Clock },
];

export function PortalBar({ name, right }: { name?: string | null; right?: ReactNode }) {
  const router = useRouter();

  const signOut = async () => {
    try {
      await createClient().auth.signOut();
    } catch {
      // Signed out or not, do not strand them in the portal: the middleware
      // will bounce the next request to the login page anyway.
    }
    router.replace("/portal/login");
    router.refresh();
  };

  return (
    <header className="portal-bar">
      <div className="portal-bar-inner">
        {/* The logo goes to the portal, not to "/". In the app the marketing
            site is fenced off, so a logo pointing there would be a dead end,
            and even in a browser a partner opening the app has no business
            being offered a cleaning. */}
        <a className="logo" href="/portal" aria-label="MALTO Partner, your jobs">
          MALTO<small>CLEANING SERVICES</small>
        </a>
        <div className="portal-bar-who">
          {name ? <span className="portal-bar-name">{name}</span> : null}
          {right}
          <button className="portal-signout" onClick={signOut} type="button">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

export function PortalTabbar({ active }: { active: PortalTab }) {
  return (
    <nav className="portal-tabbar" aria-label="Portal">
      {TABS.map(({ id, label, href, Icon }) => (
        <a
          key={id}
          className={"portal-tab" + (active === id ? " on" : "")}
          href={href}
          aria-current={active === id ? "page" : undefined}
        >
          <Icon aria-hidden="true" />
          {label}
        </a>
      ))}
    </nav>
  );
}

/** Bar, page, and the space the fixed tab bar needs. */
export function PortalChrome({
  active,
  name,
  barRight,
  children,
}: {
  active: PortalTab;
  name?: string | null;
  barRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="portal-app">
      <PortalBar name={name} right={barRight} />
      <div className="portal-shell">{children}</div>
      <div className="portal-tabbar-space" />
      <PortalTabbar active={active} />
    </div>
  );
}
