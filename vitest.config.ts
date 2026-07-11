import { defineConfig } from "vitest/config";

/**
 * Vitest workspace. Each package under packages/* is a project; Playwright
 * e2e specs in apps/web are deliberately NOT part of this graph (run via
 * `pnpm test:e2e`). apps/web unit tests join the workspace when it grows any.
 */
export default defineConfig({
  test: {
    projects: ["packages/*", "tooling/eslint-rules", "apps/web"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "json-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.typetest.ts", "**/index.ts"],
      thresholds: {
        // The money utility is the most-invoked code in the system; it must be
        // exhaustively covered (M0.6 acceptance). Enforced per-file.
        "packages/shared/src/money/{cents,decimal}.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
});
