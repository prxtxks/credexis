/**
 * Production-build smoke — the gate for the 2026-07-29 outage.
 *
 * Every other browser gate in CI drives `next dev`. Dev renders every route
 * dynamically and ships a relaxed CSP, so it is structurally blind to the two
 * defects that reached production that day:
 *
 *   1. A route-level Suspense fallback (`app/loading.tsx`) that resolved in
 *      dev but never in the production build — the app painted a full-viewport
 *      "Loading your deals…" forever. The root cause is upstream of the
 *      fallback: `export const dynamic` is route-segment config and is IGNORED
 *      inside a "use client" module, so the per-user dashboard was statically
 *      prerendered at build time and shipped as a frozen anonymous shell.
 *   2. A CSP with `strict-dynamic`. That keyword makes the browser IGNORE the
 *      `'self'` allowlist and execute only nonced scripts; prerendered HTML
 *      carries no nonce, so all 24 script tags were blocked and nothing
 *      hydrated.
 *
 * Both are invisible to `next build` exiting 0 — they are render-time, not
 * compile-time. So this spec runs ONLY against `next start` over a real
 * `next build` (see playwright.config.ts, E2E_PROD=1) and asserts the app
 * RENDERS.
 *
 * Signed-out surface only — CI has no Supabase project (dummy env; the
 * middleware fails closed, same as smoke.spec.ts). That is sufficient: the
 * prerendered HTML for /login is a CSR bailout (`useSearchParams`), so the
 * sign-in form exists in the DOM only if the client bundle downloaded, parsed
 * and rendered. A blocked script leaves that page blank.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const DEAL_ID = "00000000-0000-4000-a000-000000000001";

/** Signed-out visits must land on a rendered login page — never on a spinner. */
const PROTECTED_ROUTES = ["/", "/costs", "/settings", `/deals/${DEAL_ID}/workspace`];

/**
 * Browser-chrome noise the app does not emit. Keep this list SHORT and
 * specific: anything matched here can no longer fail this gate. A CSP refusal
 * or a hydration error never mentions these.
 */
const IGNORED_CONSOLE = [/favicon\.ico/i];

type FailureProbe = {
  /** Failures observed since the previous drain; empties the buffer. */
  drain: () => Promise<string[]>;
};

/**
 * Collects everything a broken production render shows up as: console errors
 * (CSP refusals, 404s, React hydration errors), uncaught exceptions, and the
 * `securitypolicyviolation` DOM event — the event is kept because it is the
 * only signal that names the directive that did the blocking.
 *
 * Must be installed before the first navigation: `addInitScript` runs at
 * document-start on every subsequent document.
 */
async function watchForFailures(page: Page): Promise<FailureProbe> {
  const seen: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
    seen.push(`console.error → ${text}`);
  });
  page.on("pageerror", (err) => seen.push(`uncaught → ${err.message}`));
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = violations;
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(`${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
  return {
    drain: async () => {
      const csp = await page.evaluate(
        () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
      );
      const out = [...seen, ...csp.map((v) => `csp → ${v}`)];
      seen.length = 0;
      return out;
    },
  };
}

/**
 * The outage's signature: a Suspense fallback that paints and never resolves.
 * Asserting the absence of the fallback is what a screenshot-free gate can see
 * — pair it with a positive assertion that the real content is present.
 */
async function expectNoStuckFallback(page: Page): Promise<void> {
  await expect(page.locator(".grid-loader")).toHaveCount(0);
  await expect(page.getByText(/^Loading/i)).toHaveCount(0);
}

test("login page renders, hydrates and is interactive in a production build", async ({ page }) => {
  const probe = await watchForFailures(page);
  await page.goto("/login");

  // /login prerenders to a CSR-bailout shell (no form in the static HTML).
  // These four assertions therefore prove the client bundle ran: with
  // `strict-dynamic` back in the CSP the page is blank and all four fail.
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expectNoStuckFallback(page);

  // Next's app bootstrap sets window.next as its first act — a direct read of
  // "the framework's own chunk executed", independent of our markup.
  const bootstrapped = await page.evaluate(() => "next" in window);
  expect(bootstrapped, "Next's client bundle never executed — scripts blocked?").toBe(true);

  // Interactivity, not just paint: the theme toggle renders an unlabelled
  // placeholder until an effect runs, and only flips <html class="dark"> if
  // React attached the click handler. Hydration cannot be faked past this.
  const toggle = page.getByRole("button", { name: /Switch to (light|dark) mode/ });
  await expect(toggle).toBeVisible();
  const darkBefore = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await toggle.click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")), {
      message: "theme toggle did not react — the page painted but never hydrated",
    })
    .toBe(!darkBefore);

  expect(await probe.drain(), "console errors / CSP violations on /login").toEqual([]);
});

test("no signed-out route is stuck on a loading fallback", async ({ page }) => {
  const probe = await watchForFailures(page);

  for (const route of PROTECTED_ROUTES) {
    await page.goto(route);
    await expect(page, `${route} must redirect a signed-out visitor to /login`).toHaveURL(
      /\/login/,
    );
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expectNoStuckFallback(page);
    expect(await probe.drain(), `console errors / CSP violations on ${route}`).toEqual([]);
  }

  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expectNoStuckFallback(page);
  expect(await probe.drain(), "console errors / CSP violations on /signup").toEqual([]);
});

test("production responses carry the security headers", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.status()).toBe(200);
  const headers = res.headers();

  const csp = headers["content-security-policy"] ?? "";
  expect(csp, "no Content-Security-Policy on a page response").not.toBe("");
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]) {
    expect(csp).toContain(directive);
  }
  // 2026-07-29: `strict-dynamic` voids the 'self' allowlist and admits only
  // nonced scripts, which statically prerendered pages can never carry.
  expect(csp, "'strict-dynamic' blocks every script on a prerendered page").not.toContain(
    "strict-dynamic",
  );
  // Doubles as a guard that this suite is pointed at a PRODUCTION server:
  // 'unsafe-eval' appears only in the dev CSP (HMR), and the prod-only
  // upgrade-insecure-requests only outside dev.
  expect(csp, "this is the dev CSP — the gate is testing the wrong server").not.toContain(
    "unsafe-eval",
  );
  expect(csp).toContain("upgrade-insecure-requests");

  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["strict-transport-security"]).toContain("max-age=63072000");
});

test("the authenticated dashboard is not prerendered into a static shell", async () => {
  test.skip(!!process.env["E2E_TARGET_URL"], "asserts on the local .next build output");

  // apps/web/e2e → apps/web/.next
  const nextDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".next");
  const manifest = JSON.parse(readFileSync(join(nextDir, "prerender-manifest.json"), "utf8")) as {
    routes: Record<string, unknown>;
  };

  // The root cause of the frozen fallback, caught at its source: `/` is a
  // per-user authenticated dashboard. If it appears here, `export const
  // dynamic = "force-dynamic"` was ignored (route-segment config does nothing
  // inside a "use client" module) and an anonymous shell — fallback and all —
  // was baked into the build output.
  expect(
    Object.keys(manifest.routes),
    '/ was statically prerendered — the dashboard needs a SERVER wrapper for "force-dynamic" to apply',
  ).not.toContain("/");
  expect(
    existsSync(join(nextDir, "server", "app", "page.html")),
    "a static / shell was emitted into the build output",
  ).toBe(false);
});
