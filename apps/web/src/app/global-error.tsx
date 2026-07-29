"use client";

/**
 * Root error boundary (M10.2): report to Sentry, render the fallback.
 * global-error REPLACES the root layout when it fires, so it must carry
 * its own <html>/<body>, import globals.css, apply the Geist fonts, and
 * inline the theme boot script (ui-4 restyle).
 */

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THEME_BOOT_SCRIPT } from "@/components/theme-toggle";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <main className="gradient-mesh flex min-h-screen items-center justify-center p-6">
          <div className="glass-card w-full max-w-md rounded-2xl p-8 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-severity-critical/10">
              <AlertTriangle className="h-7 w-7 text-severity-critical" />
            </div>
            <h1 className="mb-2 text-xl font-bold">Something went wrong</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              The error has been reported. Your data is unchanged.
            </p>
            <Button onClick={reset} className="px-6">
              Try again
            </Button>
          </div>
        </main>
      </body>
    </html>
  );
}
