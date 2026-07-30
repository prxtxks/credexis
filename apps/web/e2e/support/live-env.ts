/**
 * Support for LIVE e2e specs (M6.6): loads the repo-root .env.local (the
 * Playwright process does not inherit Next's env loading), exposes the
 * Management-API SQL runner and GoTrue admin-user helpers.
 *
 * Secrets never leave process memory - nothing here logs values.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1] && m[2] !== undefined && m[2] !== "") out[m[1]] = m[2];
  }
  return out;
}

// apps/web/e2e/support → repo root is four levels up.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_ENV = parseEnvFile(join(HERE, "..", "..", "..", "..", ".env.local"));

export const env = {
  accessToken: process.env["SUPABASE_ACCESS_TOKEN"] ?? ROOT_ENV["SUPABASE_ACCESS_TOKEN"],
  projectRef: process.env["SUPABASE_PROJECT_REF"] ?? ROOT_ENV["SUPABASE_PROJECT_REF"],
  supabaseUrl: process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? ROOT_ENV["NEXT_PUBLIC_SUPABASE_URL"],
  serviceRoleKey: process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? ROOT_ENV["SUPABASE_SERVICE_ROLE_KEY"],
};

/**
 * Live e2e runs only when explicitly asked for (RUN_LIVE_E2E=1) AND the
 * live-project credentials exist. Never in CI (dummy env, flag unset).
 */
export const live = Boolean(
  process.env["RUN_LIVE_E2E"] === "1" &&
    env.accessToken &&
    env.projectRef &&
    env.supabaseUrl &&
    env.serviceRoleKey,
);

/** Run SQL against the live database via the Supabase Management API. */
export async function runSql(query: string): Promise<{ ok: boolean; body: unknown }> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { ok: res.ok, body };
}

/**
 * Create a real, confirmed auth user through GoTrue's admin API - this
 * produces the identities row a password sign-in needs (hand-inserted
 * auth.users rows do not). Returns the new user id.
 */
export async function adminCreateUser(email: string, password: string): Promise<string> {
  const res = await fetch(`${env.supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.serviceRoleKey}`,
      apikey: env.serviceRoleKey ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = (await res.json()) as { id?: string; msg?: string };
  if (!res.ok || !body.id) {
    throw new Error(`admin create user failed (${res.status}): ${body.msg ?? "no id"}`);
  }
  return body.id;
}

export async function adminDeleteUser(userId: string): Promise<void> {
  await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${env.serviceRoleKey}`,
      apikey: env.serviceRoleKey ?? "",
    },
  });
}
