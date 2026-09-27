import Link from "next/link";

/**
 * Public site header and footer.
 *
 * These were copied into nine files with small differences, which meant a logo
 * or navigation change had to be made nine times and it was easy to miss one.
 * One definition now, used everywhere.
 *
 * The header takes the navigation as a prop because the homepage wants anchor
 * links while the inner pages link to real routes. Everything else, including
 * the booking call to action, is identical by default.
 */

const LOGO = (
  <>
    MALTO
    <small>CLEANING SERVICES</small>
  </>
);

/** Warm-premium default. Replaceable so the homepage can pass its own. */
export const DEFAULT_LINKS = [
  { href: "/services", label: "Services" },
  { href: "/pricing", label: "Pricing" },
  { href: "/partners", label: "Partners" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export type NavLink = { href: string; label: string };

export function SiteHeader({
  // Defaults to the standard navigation. Without this the prop was undefined,
  // the guard below fell through, and every public page shipped with a logo and
  // a booking button but no way to reach any other section.
  links,
  ctaLabel = "BOOK A CLEANING",
  ctaHref = "/book",
  backHref,
  backLabel = "Back to website",
  minimal = false,
}: {
  links?: NavLink[] | null;
  ctaLabel?: string;
  ctaHref?: string;
  backHref?: string;
  backLabel?: string;
  /** Hides the navigation and the call to action, for checkout-style pages. */
  minimal?: boolean;
}) {
  // A minimal header is a focused task page, so it keeps the back link and
  // drops the section navigation. Everything else gets the standard links
  // unless a caller passes its own.
  const navLinks = minimal ? [] : (links ?? DEFAULT_LINKS);

  return (
    <header className="header">
      <div className="container nav">
        <Link href="/" className="logo" aria-label="MALTO Cleaning Services, home">
          {LOGO}
        </Link>

        {navLinks.length > 0 && (
          <nav className="navlinks" aria-label="Main">
            {navLinks.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </nav>
        )}

        {backHref && navLinks.length === 0 && <Link className="small" href={backHref}>{backLabel}</Link>}

        {!minimal && (
          <Link className="btn nav-cta" href={ctaHref}>
            {ctaLabel}
          </Link>
        )}
      </div>
    </header>
  );
}

export function SiteFooter({
  tagline = "A Better Standard of Clean.",
  contactEmail,
  contactPhone,
}: {
  tagline?: string;
  contactEmail?: string;
  contactPhone?: string;
}) {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <div className="logo">{LOGO}</div>
          <p className="small" style={{ maxWidth: "38ch", marginTop: "12px" }}>{tagline}</p>
          {(contactEmail || contactPhone) && (
            <p className="small" style={{ marginTop: "10px" }}>
              {contactPhone && <a href={`tel:${contactPhone.replace(/[^\d+]/g, "")}`}>{contactPhone}</a>}
              {contactPhone && contactEmail ? " · " : null}
              {contactEmail && <a href={`mailto:${contactEmail}`}>{contactEmail}</a>}
            </p>
          )}
        </div>

        <div>
          <div className="footer-label">Explore</div>
          <ul className="footer-links">
            {DEFAULT_LINKS.map((l) => (
              <li key={l.href}><Link href={l.href}>{l.label}</Link></li>
            ))}
          </ul>
        </div>

        <div>
          <div className="footer-label">For partners</div>
          <ul className="footer-links">
            <li><Link href="/partners">Browse cleaners</Link></li>
            {/* The growth loop: without this, an independent cleaner has no way
                to discover that they can join. */}
            <li><Link href="/portal/register">Become a partner</Link></li>
          </ul>
        </div>

        <div>
          <div className="footer-label">Company</div>
          <ul className="footer-links">
            <li><Link href="/terms">Terms</Link></li>
            <li><Link href="/privacy">Privacy</Link></li>
            <li><Link href="/book">Book a cleaning</Link></li>
          </ul>
        </div>
      </div>
      <div className="container footer-base small">
        <span>© {new Date().getFullYear()} MALTO Cleaning Services</span>
        <span>Metro Manila and nationwide</span>
      </div>
    </footer>
  );
}
