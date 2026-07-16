import { defineConfig, devices } from "@playwright/test";

// Dedicated e2e port: 3000 is the default for every Next app on this
// machine — reuseExistingServer once connected to an unrelated project's
// dev server and tested the wrong app. 3799 keeps the suite hermetic.
const PORT = 3799;

/**
 * Playwright smoke config. Kept minimal for M0.2 — the real E2E suite
 * (upload → review → override → recompute) lands in M8.9. CI installs the
 * Chromium browser before running (see .github/workflows/ci.yml).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
