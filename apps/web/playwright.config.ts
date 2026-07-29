import { defineConfig, devices } from "@playwright/test";

// Dedicated e2e port: 3000 is the default for every Next app on this
// machine — reuseExistingServer once connected to an unrelated project's
// dev server and tested the wrong app. 3799 keeps the suite hermetic.
const PORT = 3799;
// Separate port for the production run so it can never attach to a dev
// server left running on 3799 — testing dev while believing you are testing
// production is precisely what shipped the 2026-07-29 outage.
const PROD_PORT = 3800;

// E2E_PROD=1 swaps the whole run onto a REAL production build served by
// `next start` (run `next build` first). The two modes are mutually
// exclusive: dev cannot see production-only render defects, and the prod
// spec's assertions (no 'unsafe-eval' in the CSP, no prerendered `/`) are
// false against the dev server by design. See e2e/prod-smoke.spec.ts.
const PROD_MODE = process.env.E2E_PROD === "1";

/**
 * Playwright smoke config. Kept minimal for M0.2 — the real E2E suite
 * (upload → review → override → recompute) lands in M8.9. CI installs the
 * Chromium browser before running (see .github/workflows/ci.yml).
 */
export default defineConfig({
  testDir: "./e2e",
  ...(PROD_MODE
    ? { testMatch: ["**/prod-smoke.spec.ts"] }
    : { testIgnore: ["**/prod-smoke.spec.ts"] }),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "html" : "list",
  use: {
    // E2E_TARGET_URL points the suite at a deployed environment (e.g.
    // production) — the local webServer still boots but goes unused.
    baseURL: process.env.E2E_TARGET_URL ?? `http://localhost:${PROD_MODE ? PROD_PORT : PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: PROD_MODE
    ? {
        command: `pnpm start --port ${PROD_PORT}`,
        port: PROD_PORT,
        // Never reuse: a stale server is a stale build, and this gate exists
        // to catch what only the current build output does.
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : {
        command: `pnpm dev --port ${PORT}`,
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
