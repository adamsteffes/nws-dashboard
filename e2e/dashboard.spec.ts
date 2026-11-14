import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createDashboardRoutes, LINN } from "./helpers/nwsFixtures";

const { handler, control } = createDashboardRoutes();

test.use({ mockRoutes: { nws: handler } });

test.beforeEach(() => {
  control.alerts = "alerts_active_linn-ks";
  control.forecastStatus = null;
  control.delayMs = 0;
});

async function addLinn(page: Page) {
  await page.goto("./#/manage");
  await page.getByLabel("Name", { exact: true }).fill("Linn");
  await page.getByLabel("Latitude").fill(LINN.lat);
  await page.getByLabel("Longitude").fill(LINN.lon);
  await page.getByRole("button", { name: "Add location" }).click();
  await expect(page.getByText("Added Linn.")).toBeVisible();
}

async function openDashboard(page: Page) {
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Dashboard" })
    .click();
}

const card = (page: Page) => page.locator(".wx-card");

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test("shows temperature, conditions, two forecast periods and radar", async ({
  page,
}) => {
  await addLinn(page);
  await openDashboard(page);
  await expect(card(page)).toHaveCount(1);
  await expect(card(page).locator(".wx-temp")).toHaveText("30°");
  await expect(card(page).locator(".wx-desc")).toHaveText("Clear");
  await expect(card(page).locator(".wx-periods li")).toHaveCount(2);
  await expect(card(page).locator(".wx-badge")).toHaveCount(0);
  await expect(
    card(page).getByRole("img", { name: "Radar for Linn" }),
  ).toHaveAttribute(
    "src",
    "https://radar.weather.gov/ridge/standard/KTWX_0.gif",
  );
  await expect(
    page.getByRole("main").getByRole("link", { name: "Linn" }),
  ).toHaveAttribute("href", "#/l/linn");
});

test("alert badge states the count and highest severity", async ({ page }) => {
  control.alerts = "alerts_active_multi";
  await addLinn(page);
  await openDashboard(page);
  await expect(card(page).locator(".wx-badge")).toHaveText(
    "3 alerts · Extreme",
  );
});

test("a failing forecast does not hide the temperature", async ({ page }) => {
  control.forecastStatus = 503;
  await addLinn(page);
  await openDashboard(page);
  await expect(card(page).locator(".wx-temp")).toHaveText("30°");
  await expect(card(page).locator(".error")).toHaveText(
    "Forecast: Weather Service unavailable",
  );
});

test("Refresh shows Refreshing… and then returns", async ({ page }) => {
  await addLinn(page);
  await openDashboard(page);
  await expect(card(page).locator(".wx-temp")).toBeVisible();
  control.delayMs = 500;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(
    page.getByRole("button", { name: "Refreshing…" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("offline shows the banner and saved data with a note", async ({
  page,
  context,
}) => {
  await addLinn(page);
  await openDashboard(page);
  await expect(card(page).locator(".wx-temp")).toBeVisible();
  await expect(card(page).getByText(/Showing saved data/)).toHaveCount(0);

  await context.setOffline(true);
  await expect(
    page.getByText("You're offline — showing saved data"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(
    card(page)
      .getByText(/Showing saved data from \d{1,2}:\d{2} (AM|PM)/)
      .first(),
  ).toBeVisible();
  await expect(card(page).locator(".wx-temp")).toHaveText("30°");

  await context.setOffline(false);
  await expect(page.getByText("You're offline")).toHaveCount(0);
  await expect(card(page).getByText(/Showing saved data/)).toHaveCount(0);
});

test("layout: screenshots, no overflow, 44px targets", async ({
  page,
}, testInfo) => {
  control.alerts = "alerts_active_multi";
  await addLinn(page);
  await openDashboard(page);
  await expect(card(page).locator(".wx-periods li")).toHaveCount(2);
  await expect(card(page).getByRole("img")).toBeVisible();

  const fits = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
  expect(await fits(), "no horizontal overflow").toBe(true);

  const targets = await page.locator(".wx-link, .app-header .btn").all();
  expect(targets.length).toBeGreaterThan(1);
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }

  await page.emulateMedia({ colorScheme: "light" });
  await attachScreenshot(page, testInfo, "dashboard-light");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await fits(), "no horizontal overflow in dark mode").toBe(true);
  await attachScreenshot(page, testInfo, "dashboard-dark");
});
