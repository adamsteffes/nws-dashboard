import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

// Real-network probe, run from the app's own origin so CORS behaves as it
// would on github.io. Findings are collected across tests and written out for
// the workflow summary.
const findings: Record<string, unknown> = {};

function record(name: string, value: unknown) {
  findings[name] = value;
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/live-findings.json",
    JSON.stringify(findings, null, 2),
  );
}

async function report(testInfo: TestInfo, name: string, value: unknown) {
  record(name, value);
  const body = JSON.stringify(value, null, 2);
  console.log(`[findings:${name}] ${body}`);
  await testInfo.attach(`findings-${name}`, {
    body,
    contentType: "application/json",
  });
}

const POINT = "39.7456,-97.0892";
let radarStation: string | undefined;

test.beforeEach(async ({ page }) => {
  await page.goto("./");
});

test("api.weather.gov points, forecast and alerts", async ({
  page,
}, testInfo) => {
  const result = await page.evaluate(async (point) => {
    const pointsRes = await fetch(`https://api.weather.gov/points/${point}`, {
      headers: { Accept: "application/geo+json" },
    });
    const points = pointsRes.ok ? await pointsRes.json() : undefined;
    const forecastUrl: string | undefined = points?.properties?.forecast;
    const forecastRes = forecastUrl ? await fetch(forecastUrl) : undefined;
    const forecast = forecastRes?.ok ? await forecastRes.json() : undefined;
    const alertsRes = await fetch(
      `https://api.weather.gov/alerts/active?point=${point}`,
    );
    return {
      pointsOk: pointsRes.ok,
      pointsStatus: pointsRes.status,
      pointsCacheControl: pointsRes.headers.get("cache-control"),
      radarStation: points?.properties?.radarStation as string | undefined,
      forecastUrl,
      forecastOk: forecastRes?.ok,
      periods: forecast?.properties?.periods?.length as number | undefined,
      alertsOk: alertsRes.ok,
      alertsStatus: alertsRes.status,
    };
  }, POINT);
  radarStation = result.radarStation;
  await report(testInfo, "nws", result);

  expect(result.pointsOk, "points ok").toBe(true);
  expect(result.forecastUrl, "points has properties.forecast").toBeTruthy();
  expect(result.periods ?? 0, "forecast periods").toBeGreaterThan(0);
  expect(result.alertsOk, "alerts ok").toBe(true);
});

test("api.weather.gov custom header CORS preflight (informational)", async ({
  page,
}, testInfo) => {
  const result = await page.evaluate(async (point) => {
    try {
      const res = await fetch(`https://api.weather.gov/points/${point}`, {
        headers: { "X-Contact": "test" },
      });
      return { succeeded: res.ok, status: res.status };
    } catch (err) {
      return { succeeded: false, error: String(err) };
    }
  }, POINT);
  await report(testInfo, "customHeaderPreflight", result);
});

async function probeImage(page: Page, url: string) {
  return page.evaluate(
    (src) =>
      new Promise<{ loaded: boolean; naturalWidth: number }>((resolve) => {
        const img = new Image();
        img.onload = () =>
          resolve({ loaded: true, naturalWidth: img.naturalWidth });
        img.onerror = () => resolve({ loaded: false, naturalWidth: 0 });
        img.src = src;
      }),
    url,
  );
}

test("radar.weather.gov images load via <img>", async ({ page }, testInfo) => {
  const station = radarStation ?? "KEAX";
  const base = "https://radar.weather.gov/ridge/standard";
  const urls = {
    loop: `${base}/${station}_loop.gif`,
    still: `${base}/${station}_0.gif`,
    conusLoop: `${base}/CONUS_loop.gif`,
  };
  const [loop, still, conusLoop] = await Promise.all([
    probeImage(page, urls.loop),
    probeImage(page, urls.still),
    probeImage(page, urls.conusLoop),
  ]);
  await report(testInfo, "radar", {
    station,
    stationFromPoints: radarStation !== undefined,
    loop: { url: urls.loop, ...loop },
    still: { url: urls.still, ...still },
    conusLoop: { url: urls.conusLoop, ...conusLoop },
  });

  expect(
    loop.naturalWidth > 0 || still.naturalWidth > 0,
    "station loop or still loads",
  ).toBe(true);
});

test("nominatim search", async ({ page }, testInfo) => {
  const result = await page.evaluate(async () => {
    const res = await fetch(
      "https://nominatim.openstreetmap.org/search?q=66502&countrycodes=us&format=jsonv2&limit=1",
    );
    const body = res.ok ? await res.json() : undefined;
    return {
      ok: res.ok,
      status: res.status,
      isArray: Array.isArray(body),
      count: Array.isArray(body) ? body.length : undefined,
    };
  });
  await report(testInfo, "nominatim", result);

  expect(result.ok, "nominatim ok").toBe(true);
  expect(result.isArray, "nominatim returns an array").toBe(true);
});
