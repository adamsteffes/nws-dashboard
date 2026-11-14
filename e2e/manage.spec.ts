import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { LINN, nwsLocationRoutes } from "./helpers/nwsFixtures";

test.use({ mockRoutes: { nws: nwsLocationRoutes } });

async function addLocation(page: Page, name: string, lat: string, lon: string) {
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Latitude").fill(lat);
  await page.getByLabel("Longitude").fill(lon);
  await page.getByRole("button", { name: "Add location" }).click();
}

const savedList = (page: Page) => page.locator(".loc-list");

/** Forces the "show the JSON in a textarea" export path so no file picker or download is involved. */
async function disableSharingAndDownloads(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(URL, "createObjectURL", { value: undefined });
    Object.defineProperty(navigator, "share", { value: undefined });
    Object.defineProperty(navigator, "canShare", { value: undefined });
  });
}

test("adds a location by coordinates and shows it on the dashboard", async ({
  page,
}) => {
  await page.goto("./#/manage");
  await addLocation(page, "Linn", LINN.lat, LINN.lon);
  await expect(page.getByText("Added Linn.")).toBeVisible();
  const row = savedList(page).locator("li", { hasText: "Linn" });
  await expect(row).toContainText("Linn, KS");
  await expect(row).toContainText("39.7456, -97.0892");

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Dashboard" })
    .click();
  await expect(page.getByText("No locations yet")).toHaveCount(0);
  await page.getByRole("main").getByRole("link", { name: "Linn" }).click();
  await expect(page).toHaveURL(/#\/l\/linn$/);
  await expect(page).toHaveTitle("Linn — NWS Weather");
  await expect(
    page.getByRole("heading", { level: 1, name: "Linn" }),
  ).toBeVisible();
});

test("unknown location id shows a not-found message", async ({ page }) => {
  await page.goto("./#/l/nowhere");
  await expect(
    page.getByRole("heading", { name: "Location not found" }).first(),
  ).toBeVisible();
});

test("renames a location", async ({ page }) => {
  await page.goto("./#/manage");
  await addLocation(page, "Linn", LINN.lat, LINN.lon);
  await page.getByRole("button", { name: "Rename Linn" }).click();
  await page.getByLabel("New name for Linn").fill("Cabin");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(savedList(page).locator(".loc-link")).toHaveText("Cabin");
});

test("deletes a location only after confirming", async ({ page }) => {
  await page.goto("./#/manage");
  await addLocation(page, "Linn", LINN.lat, LINN.lon);
  await expect(savedList(page)).toContainText("Linn");

  await page.getByRole("button", { name: "Delete Linn" }).click();
  await expect(page.getByText("Delete Linn?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(savedList(page)).toContainText("Linn");

  await page.getByRole("button", { name: "Delete Linn" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByText("No saved locations yet")).toBeVisible();
});

test("explains a spot outside NWS coverage", async ({ page }) => {
  await page.goto("./#/manage");
  await addLocation(page, "Nowhere", "0", "0");
  await expect(
    page.getByText(
      "That spot is outside National Weather Service coverage (US and territories only).",
    ),
  ).toBeVisible();
  await expect(page.getByText("No saved locations yet")).toBeVisible();
});

test("re-resolves a saved location", async ({ page }) => {
  await page.goto("./#/manage");
  await addLocation(page, "Linn", LINN.lat, LINN.lon);
  await page.getByRole("button", { name: "Re-resolve Linn" }).click();
  await expect(page.getByText("Updated weather data for Linn.")).toBeVisible();
});

test.describe("geolocation", () => {
  test.use({
    geolocation: { latitude: 39.7456, longitude: -97.0892 },
    permissions: ["geolocation"],
  });

  test("fills the form from the device location", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "Playwright's WebKit does not reliably honour the geolocation override",
    );
    await page.goto("./#/manage");
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByLabel("Latitude")).toHaveValue("39.7456");
    await expect(page.getByLabel("Longitude")).toHaveValue("-97.0892");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "My location",
    );
    await page.getByRole("button", { name: "Add location" }).click();
    await expect(savedList(page)).toContainText("My location");
  });
});

test("export then import round-trips through pasted JSON", async ({ page }) => {
  await disableSharingAndDownloads(page);
  await page.goto("./#/manage");
  await addLocation(page, "Linn", LINN.lat, LINN.lon);
  await expect(savedList(page)).toContainText("Linn");

  await page.getByRole("button", { name: "Export locations" }).click();
  const exported = page.locator("#export-text");
  await expect(exported).toBeVisible();
  const json = await exported.inputValue();
  expect(JSON.parse(json).locations[0].name).toBe("Linn");

  await page.getByRole("button", { name: "Delete Linn" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByText("No saved locations yet")).toBeVisible();

  await page.getByLabel("Or paste JSON").fill(json);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Imported: 1 added.")).toBeVisible();
  await expect(savedList(page)).toContainText("Linn, KS");
});

test("replace import asks for confirmation", async ({ page }) => {
  await page.goto("./#/manage");
  await addLocation(page, "Linn", LINN.lat, LINN.lon);
  await expect(savedList(page)).toContainText("Linn");
  await page.getByLabel("When importing").selectOption("replace");
  await page.getByLabel("Or paste JSON").fill(
    JSON.stringify({
      version: 1,
      locations: [{ name: "Cabin", lat: 30, lon: -90 }],
    }),
  );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export first" }),
  ).toBeVisible();
  await expect(savedList(page)).toContainText("Linn");
  await page.getByRole("button", { name: "Yes, replace" }).click();
  await expect(savedList(page)).toContainText("Cabin");
  await expect(savedList(page)).not.toContainText("Linn");
});

test("reload keeps saved locations", async ({ page }) => {
  await page.goto("./#/manage");
  await addLocation(page, "Linn", LINN.lat, LINN.lon);
  await expect(savedList(page)).toContainText("Linn");
  await page.reload();
  await expect(savedList(page)).toContainText("Linn, KS");
});

async function populate(page: Page) {
  await disableSharingAndDownloads(page);
  await page.goto("./#/manage");
  await addLocation(page, "Linn", LINN.lat, LINN.lon);
  await expect(savedList(page)).toContainText("Linn");
  await page.getByRole("button", { name: "Export locations" }).click();
  await expect(page.locator("#export-text")).toBeVisible();
}

test("every control on the Locations page is at least 44px tall", async ({
  page,
}) => {
  await populate(page);
  const controls = page
    .locator("main")
    .locator("button, input, select, textarea, a");
  const count = await controls.count();
  expect(count).toBeGreaterThan(10);
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    const label = await control.evaluate((el) => el.outerHTML.slice(0, 80));
    expect(box?.height, label).toBeGreaterThanOrEqual(44);
  }
});

test("Locations page has no horizontal overflow at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await populate(page);
  await page.getByRole("button", { name: "Rename Linn" }).click();
  await page.getByLabel("New name for Linn").fill("A".repeat(60));
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: /^Delete/ }).click();
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
});
