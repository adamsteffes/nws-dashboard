import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

const fitsViewport = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );

test("navigates between Dashboard and Locations", async ({ page }) => {
  await page.goto("./");
  const nav = page.getByRole("navigation", { name: "Primary" });
  const dashboard = nav.getByRole("link", { name: "Dashboard" });
  const locations = nav.getByRole("link", { name: "Locations" });

  await expect(dashboard).toHaveAttribute("aria-current", "page");
  await expect(locations).not.toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle("NWS Weather");

  await locations.click();
  await expect(page).toHaveURL(/#\/manage$/);
  await expect(locations).toHaveAttribute("aria-current", "page");
  await expect(dashboard).not.toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle("Locations — NWS Weather");
  await expect(
    page.getByRole("heading", { level: 1, name: "Locations" }),
  ).toBeFocused();

  await dashboard.click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(dashboard).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle("NWS Weather");

  await expect(page.getByText("No locations yet")).toBeVisible();
  await page.getByRole("link", { name: "Add a location" }).click();
  await expect(page).toHaveURL(/#\/manage$/);
  await expect(page).toHaveTitle("Locations — NWS Weather");
});

test("unknown hash shows not-found with a link back", async ({ page }) => {
  await page.goto("./#/does-not-exist");
  await expect(
    page.getByRole("heading", { level: 2, name: "Page not found" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Page not found — NWS Weather");
  await page.getByRole("link", { name: "Back to the dashboard" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByText("No locations yet")).toBeVisible();
});

test("offline banner follows connectivity", async ({ page, context }) => {
  await page.goto("./");
  const banner = page.getByText("You're offline — showing saved data");
  await expect(banner).toHaveCount(0);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(banner).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(banner).toHaveCount(0);
});

test("has no horizontal overflow at the project viewport", async ({ page }) => {
  for (const hash of ["#/", "#/manage", "#/nope"]) {
    await page.goto(`./${hash}`);
    await expect(page.locator("h1")).toBeVisible();
    expect(await fitsViewport(page), hash).toBe(true);
  }
});

test("has no horizontal overflow at 320px wide", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const hash of ["#/", "#/manage", "#/nope"]) {
    await page.goto(`./${hash}`);
    await expect(page.locator("h1")).toBeVisible();
    expect(await fitsViewport(page), hash).toBe(true);
  }
});

test("header controls are at least 44x44", async ({ page }) => {
  await page.goto("./");
  const controls = page.locator("header").locator("a, button");
  const count = await controls.count();
  expect(count).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < count; i++) {
    const box = await controls.nth(i).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme} screenshot`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("./");
    await expect(page.getByText("No locations yet")).toBeVisible();
    await attachScreenshot(page, testInfo, `shell-${scheme}`);
  });
}
