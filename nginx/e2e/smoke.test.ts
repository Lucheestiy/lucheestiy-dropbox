import { test, expect } from "@playwright/test";

test("health check endpoint", async ({ request }) => {
  const response = await request.get("/health");
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data.status).toBe("healthy");
});

test("main gallery loads (with error state for missing hash)", async ({ page }) => {
  await page.goto("/gallery/invalid-hash");
  // It should show some error or empty state because share hash is invalid
  await expect(page).toHaveTitle(/Shared Media Gallery/);
  // The status element might contain "Checking share link..." initially, but then show error
  const errorTitle = page.locator("#errorTitle");
  await expect(errorTitle).toBeVisible();
});

test("request page loads", async ({ page }) => {
  await page.goto("/request/invalid-hash");
  // The UI shows "This request link is not available." for invalid hashes
  await expect(page.locator("#subtitle")).toContainText("This request link is not available");
});
