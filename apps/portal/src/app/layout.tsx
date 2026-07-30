import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Credexis - Document portal",
  description: "Send your lender the documents they asked for.",
  // A borrower portal has nothing to gain from being indexed and plenty to
  // lose: invite links pasted into indexable pages, and a lender-branded
  // sign-in page surfacing in search results is phishing bait.
  robots: { index: false, follow: false },
};

/**
 * The portal's root layout is intentionally bare: no providers, no toaster, no
 * theme script. Nothing here may pull in staff-app code - this deployment
 * contains no engine, no tRPC root and no underwriting UI (design 05 §10.1).
 *
 * There is no root `loading.tsx` in this app and none may be added: a
 * full-viewport route Suspense fallback never resolved in a production build
 * and froze apps/web on 2026-07-29.
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${GeistSans.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
