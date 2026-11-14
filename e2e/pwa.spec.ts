import { expect, test } from "./fixtures";

const IPAD_SAFARI_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

test.describe("manifest and icons", () => {
  test("manifest is served with the expected fields", async ({ request }) => {
    const response = await request.get("manifest.webmanifest");
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      name: "NWS Weather",
      short_name: "Weather",
      start_url: "/nws-dashboard/",
      scope: "/nws-dashboard/",
      id: "/nws-dashboard/",
      display: "standalone",
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192" }),
        expect.objectContaining({ sizes: "512x512" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );
  });

  test("index links the manifest and apple-touch-icon", async ({ page }) => {
    await page.goto("./");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/nws-dashboard/manifest.webmanifest",
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/nws-dashboard/apple-touch-icon-180x180.png",
    );
  });

  for (const path of [
    "apple-touch-icon-180x180.png",
    "pwa-192x192.png",
    "pwa-512x512.png",
    "maskable-icon-512x512.png",
  ]) {
    test(`${path} is a PNG`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/png");
    });
  }
});

test.describe("service worker", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Service workers are only exercised on Chromium; WebKit in Playwright is not a reliable SW host.",
  );

  test("serves the app shell offline", async ({ page, context }) => {
    await page.goto("./");
    await page.evaluate(() => navigator.serviceWorker.ready);
    // clientsClaim lets the worker take over without a second load, but reload
    // anyway so the next navigation is certainly worker-controlled.
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "NWS Weather" }),
    ).toBeVisible();
    await context.setOffline(false);
  });

  test("does not intercept NWS API requests", async ({ page }) => {
    const hits: string[] = [];
    await page.route("https://api.weather.gov/**", (route) => {
      hits.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ ok: true }),
      });
    });
    await page.goto("./");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);

    const body = await page.evaluate(async () => {
      const response = await fetch("https://api.weather.gov/points/1,2");
      return response.json();
    });
    expect(body).toEqual({ ok: true });
    expect(hits).toEqual(["https://api.weather.gov/points/1,2"]);
  });
});

test.describe("install hint", () => {
  test.use({ userAgent: IPAD_SAFARI_UA });

  test("shows on iPad Safari and stays dismissed after reload", async ({
    page,
  }) => {
    await page.goto("./");
    const hint = page.getByText("tap Share, then Add to Home Screen");
    await expect(hint).toBeVisible();

    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(hint).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "NWS Weather" }),
    ).toBeVisible();
    await expect(hint).toHaveCount(0);
  });
});

test("install hint is hidden on desktop browsers", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium" || isMobile,
    "Only the desktop Chromium project has a non-iOS user agent.",
  );
  await page.goto("./");
  await expect(
    page.getByRole("heading", { level: 1, name: "NWS Weather" }),
  ).toBeVisible();
  await expect(page.getByText("Add to Home Screen")).toHaveCount(0);
});
