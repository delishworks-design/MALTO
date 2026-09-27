import type { Metadata } from "next";
// globals.css carries the existing class set the admin and portal still use.
// design-system.css layers the new tokens and base rules on top of it, so the
// public pages can be rebuilt against a system without stranding the working
// screens.
import "./globals.css";
import "./design-system.css";
import "./portal.css";

export const metadata: Metadata = {
  title: "MALTO Cleaning Services | A Better Standard of Clean.",
  description: "Reliable cleaning services for homes and small businesses.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
