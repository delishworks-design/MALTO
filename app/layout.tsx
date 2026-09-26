import type { Metadata } from "next";
import "./globals.css";

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
