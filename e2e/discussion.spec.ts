import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  AFD_NEWEST,
  AFD_OLDER,
  AFD_OLDER_MARKER,
  createAfdRoutes,
} from "./helpers/afdFixtures";
import {
  createDashboardRoutes,
  FIXTURE_NOW,
  LINN,
} from "./helpers/nwsFixtures";

const { handler: dashboardHandler } = createDashboardRoutes();
const { handler, control } = createAfdRoutes(dashboardHandler);

test.use({ mockRoutes: { nws: handler } });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(FIXTURE_NOW) });
  control.listStatus = null;
});

async function addLinn(page: Page) {
  await page.goto("./#/manage");
  await page.getByLabel("Name", { exact: true }).fill("Linn");
  await page.getByLabel("Latitude").fill(LINN.lat);
  await page.getByLabel("Longitude").fill(LINN.lon);
  await page.getByRole("button", { name: "Add location" }).click();
  await expect(page.getByText("Added Linn.")).toBeVisible();
}

async function openDiscussion(page: Page, query = "") {
  await page.evaluate((q) => {
    window.location.hash = `#/l/linn/afd${q}`;
  }, query);
  await expect(
    page.getByRole("heading", { name: "Forecast discussion", level: 2 }),
  ).toBeVisible();
}

const text = (page: Page) => page.locator("pre.afd-text").first();

const fitsWidth = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test("shows the latest discussion with its local issuance time", async ({
  page,
}) => {
  await addLinn(page);
  await openDiscussion(page);
  await expect(text(page)).toContainText("Area Forecast Discussion");
  await expect(text(page)).toContainText("KEY MESSAGES");
  await expect(
    page.getByText("KTOP — issued Nov 12, 10:36 PM CST"),
  ).toBeVisible();
  await expect(page.getByText("for Linn")).toBeVisible();
  await expect(page).toHaveTitle(/^Forecast discussion — Linn/);
  await expect(
    page.getByRole("link", { name: /Back to Linn/ }),
  ).toHaveAttribute("href", "#/l/linn");
});

test("a previous issuance opens with ?p= and changes the text", async ({
  page,
}) => {
  await addLinn(page);
  await openDiscussion(page);
  await expect(text(page)).not.toContainText(AFD_OLDER_MARKER);
  const history = page.locator(".afd-history");
  await expect(history.locator(".afd-current")).toHaveCount(1);
  await history.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`#/l/linn/afd\\?p=${AFD_OLDER}$`));
  await expect(text(page)).toContainText(AFD_OLDER_MARKER);
  // The viewed issuance is now the marked one, and the newest is a link.
  await expect(history.locator(`a[href$="?p=${AFD_NEWEST}"]`)).toHaveCount(1);
  await expect(history.locator(".afd-current")).toHaveCount(1);
});

test("a failing list leaves the discussion readable", async ({ page }) => {
  control.listStatus = 503;
  await addLinn(page);
  await openDiscussion(page, `?p=${AFD_OLDER}`);
  await expect(text(page)).toContainText(AFD_OLDER_MARKER);
  await expect(
    page.getByText("Previous discussions: Weather Service unavailable"),
  ).toBeVisible();
});

test("sections toggle builds a table of contents that scrolls without changing the hash", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await addLinn(page);
  await openDiscussion(page);
  await page.getByRole("button", { name: "Sections" }).click();
  const toc = page.getByRole("navigation", { name: "Sections" });
  await expect(toc.getByRole("link")).toHaveCount(4);
  await expect(toc.getByRole("link", { name: "DISCUSSION" })).toBeVisible();

  const hashBefore = await page.evaluate(() => window.location.hash);
  await toc
    .getByRole("link", { name: "TOP WATCHES/WARNINGS/ADVISORIES" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "TOP WATCHES/WARNINGS/ADVISORIES",
      level: 3,
    }),
  ).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.location.hash)).toBe(hashBefore);
  await expect(
    page.getByRole("heading", { name: "Forecast discussion", level: 2 }),
  ).toHaveCount(1);

  // Back to the raw view.
  await page.getByRole("button", { name: "Sections" }).click();
  await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(
    0,
  );
  await expect(text(page)).toContainText("KEY MESSAGES");
});

test("layout: readable text, no overflow at 320px, 44px targets, screenshots", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await addLinn(page);
  await openDiscussion(page);
  await expect(text(page)).toContainText("Area Forecast Discussion");
  expect(await fitsWidth(page), "no horizontal overflow").toBe(true);

  const style = await text(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: Number.parseFloat(s.fontSize), wrap: s.whiteSpace };
  });
  expect(style.size).toBeGreaterThanOrEqual(15);
  expect(style.wrap).toBe("pre-wrap");

  await page.getByRole("button", { name: "Sections" }).click();
  expect(await fitsWidth(page), "no overflow in sections view").toBe(true);

  const targets = await page
    .locator(".back-link, .afd-toggle, .afd-toc a, .afd-history a")
    .all();
  expect(targets.length).toBeGreaterThan(4);
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }

  await page.emulateMedia({ colorScheme: "light" });
  await attachScreenshot(page, testInfo, "discussion-light");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await fitsWidth(page), "no overflow in dark mode").toBe(true);
  await attachScreenshot(page, testInfo, "discussion-dark");
});
