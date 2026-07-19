"use client";

/** Root error boundary (M10.2): report to Sentry, render a plain fallback. */

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

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
    <html lang="en">
      <body style={{ fontFamily: "system-ui", padding: 48, textAlign: "center" }}>
        <h1>Something went wrong</h1>
        <p>The error has been reported. Your data is unchanged.</p>
        <button onClick={reset} style={{ padding: "8px 16px", marginTop: 12 }}>
          Try again
        </button>
      </body>
    </html>
  );
}
