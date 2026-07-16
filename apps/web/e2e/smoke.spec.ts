import { expect, test } from "@playwright/test";

test("unauthenticated visit to / redirects to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Credexis" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("login page is directly reachable without a session", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});

test("review queue route is auth-gated (M6.4)", async ({ page }) => {
  await page.goto("/deals/00000000-0000-4000-a000-000000000001/review");
  await expect(page).toHaveURL(/\/login/);
});
