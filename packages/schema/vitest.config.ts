import { defineConfig } from "vitest/config";

/**
 * The *.integration.test.ts suites in this package run transactions against
 * the LIVE Supabase database (role impersonation + rolled-back seeds).
 * Running those files in parallel contends for the same tables/locks and
 * flakes — so this package's test files run one at a time. Unit suites here
 * are tiny; the serialization cost is milliseconds.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    // Integration tests make several Management-API round-trips per case;
    // the default 5s flakes on API latency spikes.
    testTimeout: 60_000,
  },
});
