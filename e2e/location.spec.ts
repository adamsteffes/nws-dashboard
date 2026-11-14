import { readFileSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  createDashboardRoutes,
  FIXTURE_NOW,
  fixtureTempF,
  LINN,
} from "./helpers/nwsFixtures";

const { handler, control } = createDashboardRoutes();

const radarGif = readFileSync(
  new URL("../tests/fixtures/radar/sample.gif", import.meta.url),
);
const radar = { failStation: false };

test.use({
  mockRoutes: {
    nws: handler,
    radar: (route) =>
      radar.failStation && route.request().url().includes("KTWX")
        ? route.fulfill({ status: 404, body: "" })
        : route.fulfill({
            status: 200,
            contentType: "image/gif",
            headers: { "access-control-allow-origin": "*" },
            body: radarGif,
          }),
  },
});

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(FIXTURE_NOW) });
  control.alerts = "alerts_active_multi";
  control.forecastStatus = null;
  control.delayMs = 0;
  radar.failStation = false;
});

async function openLinnDetail(page: Page) {
  await page.goto("./#/manage");
  await page.getByLabel("Name", { exact: true }).fill("Linn");
  await page.getByLabel("Latitude").fill(LINN.lat);
  await page.getByLabel("Longitude").fill(LINN.lon);
  await page.getByRole("button", { name: "Add location" }).click();
  await expect(page.getByText("Added Linn.")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Dashboard" })
    .click();
  await expect(page.locator(".wx-card .wx-temp")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Linn" }).click();
  await expect(page).toHaveURL(/#\/l\/linn$/);
  await expect(page.locator("table.hourly tbody tr").first()).toBeVisible();
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

const fits = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );

test("opens from a dashboard card and shows the header", async ({ page }) => {
  await openLinnDetail(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Linn");
  await expect(page).toHaveTitle("Linn — NWS Weather");
  await expect(page.locator(".loc-detail-head")).toContainText(
    "Linn, KS · 39.7456, -97.0892",
  );
  await expect(
    page.getByRole("link", { name: "Forecast discussion" }),
  ).toHaveAttribute("href", "#/l/linn/afd");
  await page.getByRole("link", { name: "Back to Dashboard" }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test("lists alerts most severe first, expandable", async ({ page }) => {
  await openLinnDetail(page);
  const items = page.locator("details.alert-item");
  await expect(items).toHaveCount(3);
  await expect(items.locator(".alert-event")).toHaveText([
    "Tornado Warning",
    "Winter Weather Advisory",
    "Frost Advisory",
  ]);
  await expect(items.locator(".severity")).toHaveText([
    "Extreme",
    "Moderate",
    "Minor",
  ]);
  await expect(items.first().locator("summary")).toContainText("until Jan 15");
  await expect(items.first().locator(".alert-body")).toBeHidden();
  await items.first().locator("summary").click();
  await expect(items.first().locator(".alert-body")).toBeVisible();
  await expect(items.first().locator("h3")).toHaveText("What to do");
});

test("shows current conditions", async ({ page }) => {
  await openLinnDetail(page);
  const section = page.locator("[aria-labelledby=current-h]");
  await expect(section.locator(".wx-temp")).toHaveText(fixtureTempF("KMYZ"));
  await expect(section.locator(".wx-desc")).toHaveText("Clear");
  await expect(section.locator("dl")).toContainText("86%");
  await expect(section.locator("dl")).toContainText("30.19 inHg");
  await expect(section.locator("dl")).toContainText("10 mi");
  await expect(section.locator("dl")).toContainText("N 3 mph");
  await expect(section.locator("dl")).toContainText("KMYZ");
  await expect(section.locator(".wx-age")).toContainText("25 min ago");
});

test("shows 14 forecast periods and 48 hourly rows", async ({ page }) => {
  await openLinnDetail(page);
  await expect(page.locator(".detail-periods > li")).toHaveCount(14);
  await expect(page.locator(".detail-periods > li").first()).toContainText(
    "Overnight",
  );
  await page.locator(".detail-periods > li").first().locator("summary").click();
  await expect(
    page.locator(".detail-periods > li").first().locator("details p"),
  ).toBeVisible();
  await expect(page.locator("table.hourly tbody tr:not(.day-row)")).toHaveCount(
    48,
  );
  // The first hour is 2:00 AM in the location's own zone, whatever the device uses.
  await expect(
    page.locator("table.hourly tbody tr:not(.day-row) th").first(),
  ).toHaveText("2:00 AM");
  await expect(page.locator("table.hourly .day-row")).toHaveText([
    "Friday",
    "Saturday",
    "Sunday",
  ]);
});

test("radar loop falls back to the national loop on error", async ({
  page,
}) => {
  radar.failStation = true;
  await openLinnDetail(page);
  const img = page.locator(".wx-radar img");
  await expect(img).toHaveAttribute("src", /CONUS_loop\.gif$/);
  await expect(img).toHaveAttribute("alt", /National radar/);
  await expect(
    page.getByRole("link", { name: "Open full radar" }),
  ).toHaveAttribute("href", "https://radar.weather.gov/station/KTWX/standard");
});

test("radar shows the station loop", async ({ page }) => {
  await openLinnDetail(page);
  await expect(page.locator(".wx-radar img")).toHaveAttribute(
    "src",
    /KTWX_loop\.gif$/,
  );
});

test("one failing panel leaves the others", async ({ page }) => {
  control.forecastStatus = 503;
  await openLinnDetail(page);
  await expect(page.locator("[aria-labelledby=forecast-h] .error")).toHaveText(
    "Forecast: Weather Service unavailable",
  );
  await expect(page.locator("table.hourly tbody tr").first()).toBeVisible();
  await expect(page.locator(".wx-temp").first()).toHaveText(
    fixtureTempF("KMYZ"),
  );
});

test("columns: two on wide screens, one on narrow", async ({ page }) => {
  await openLinnDetail(page);
  const left = await page.locator(".two-col > div").first().boundingBox();
  const right = await page.locator(".two-col > div").nth(1).boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  if (width >= 1024) {
    expect(right?.x).toBeGreaterThan((left?.x ?? 0) + 100);
  } else {
    expect(right?.x).toBe(left?.x);
    expect(right?.y).toBeGreaterThan(left?.y ?? 0);
  }
});

test("a 320px screen has no page-level overflow; the hourly table scrolls inside", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openLinnDetail(page);
  await page.locator("details.alert-item summary").first().click();
  expect(await fits(page), "no horizontal overflow").toBe(true);
  const scroll = page.locator(".table-scroll");
  const { scrollWidth, clientWidth } = await scroll.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);
});

test("layout: 44px targets, screenshots in both color schemes", async ({
  page,
}, testInfo) => {
  await openLinnDetail(page);
  await expect(page.locator(".wx-radar img")).toBeVisible();
  expect(await fits(page), "no horizontal overflow").toBe(true);

  const targets = await page
    .locator(
      ".app-header .btn, .loc-detail-head .btn, details.alert-item summary, .period-details summary, [aria-labelledby=radar-h] .btn",
    )
    .all();
  expect(targets.length).toBeGreaterThan(5);
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }

  await page.emulateMedia({ colorScheme: "light" });
  await attachScreenshot(page, testInfo, "location-light");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await fits(page), "no horizontal overflow in dark mode").toBe(true);
  await attachScreenshot(page, testInfo, "location-dark");
});

test("Refresh reloads the detail page", async ({ page }) => {
  await openLinnDetail(page);
  control.delayMs = 400;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(
    page.getByRole("button", { name: "Refreshing…" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  await expect(page.locator("table.hourly tbody tr").first()).toBeVisible();
});
