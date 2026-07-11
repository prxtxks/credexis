import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config. `generate` works offline (schema → SQL in ./drizzle);
 * `migrate` needs DATABASE_URL (direct connection, not the pooler).
 */
export default defineConfig({
  dialect: "postgresql",
  // Compiled output, not src: drizzle-kit's loader can't resolve the ESM
  // .js-extension imports our TS source uses. db:generate builds first.
  schema: "./dist/db/index.js",
  out: "./drizzle",
  dbCredentials: {
    // Only needed for `drizzle-kit migrate/push`; generate never connects.
    url: process.env["DATABASE_URL"] ?? "postgres://localhost:5432/credexis",
  },
  strict: true,
  verbose: true,
});
