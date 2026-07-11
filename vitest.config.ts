import { defineConfig } from "vitest/config";

/**
 * Vitest workspace. Each package under packages/* is a project; Playwright
 * e2e specs in apps/web are deliberately NOT part of this graph (run via
 * `pnpm test:e2e`). apps/web unit tests join the workspace when it grows any.
 */
export default defineConfig({
  test: {
    projects: ["packages/*"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "json-summary"],
    },
  },
});
