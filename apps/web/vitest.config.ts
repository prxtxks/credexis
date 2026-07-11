import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Unit tests for server code (tRPC authz). e2e specs run via Playwright. */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
