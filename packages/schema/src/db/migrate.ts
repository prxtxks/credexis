#!/usr/bin/env node
/**
 * Migration runner (`pnpm db:migrate`). Applies ./drizzle/*.sql in order via
 * drizzle-orm's migrator. Uses DATABASE_URL — the DIRECT connection string
 * (migrations must not run through the transaction pooler).
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error("DATABASE_URL is not set (use the direct connection string)");
  }
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("migrations applied");
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(`migrate failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
