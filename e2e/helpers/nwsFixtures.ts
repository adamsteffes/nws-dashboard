import { readFileSync } from "node:fs";
import type { RouteHandler } from "./mockNetwork";

const fixture = (name: string): string =>
  readFileSync(
    new URL(`../../tests/fixtures/nws/${name}.json`, import.meta.url),
    "utf-8",
  );

const API = "https://api.weather.gov";

export const LINN = { lat: "39.7456", lon: "-97.0892" };

const BODIES: Record<string, { fixture: string; status: number }> = {
  [`${API}/points/39.7456,-97.0892`]: {
    fixture: "points_linn-ks",
    status: 200,
  },
  [`${API}/gridpoints/TOP/32,81/stations`]: {
    fixture: "stations_linn-ks",
    status: 200,
  },
  [`${API}/points/0,0`]: { fixture: "points_404", status: 404 },
};

/** Answers the points and stations lookups the Locations page makes. */
export const nwsLocationRoutes: RouteHandler = (route) => {
  const hit = BODIES[route.request().url()];
  return route.fulfill({
    status: hit?.status ?? 404,
    contentType:
      hit?.status === 200 ? "application/geo+json" : "application/problem+json",
    headers: { "access-control-allow-origin": "*" },
    body: hit
      ? fixture(hit.fixture)
      : JSON.stringify({ title: "Not Found", status: 404 }),
  });
};

export interface DashboardControl {
  alerts: string;
  /** When set, forecast requests fail with this status. */
  forecastStatus: number | null;
  /** Delays alerts, observation and forecast answers so loading states can be observed. */
  delayMs: number;
}

/**
 * Answers everything the dashboard needs for Linn, KS. Tests change `control`
 * between requests to vary the responses.
 */
export function createDashboardRoutes(): {
  handler: RouteHandler;
  control: DashboardControl;
} {
  const control: DashboardControl = {
    alerts: "alerts_active_linn-ks",
    forecastStatus: null,
    delayMs: 0,
  };
  const bodies: Record<string, () => string> = {
    [`${API}/gridpoints/TOP/32,81/forecast`]: () => fixture("forecast_linn-ks"),
    [`${API}/stations/KMYZ/observations/latest`]: () =>
      fixture("obs_latest_linn-ks_KMYZ"),
    [`${API}/stations/KCNK/observations/latest`]: () =>
      fixture("obs_latest_linn-ks_KCNK"),
    [`${API}/alerts/active?point=39.7456,-97.0892`]: () =>
      fixture(control.alerts),
  };
  const handler: RouteHandler = async (route) => {
    const url = route.request().url();
    const body = bodies[url];
    if (!body) return nwsLocationRoutes(route);
    if (control.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, control.delayMs));
    }
    if (url.endsWith("/forecast") && control.forecastStatus !== null) {
      return route.fulfill({
        status: control.forecastStatus,
        contentType: "application/problem+json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          title: "Unavailable",
          status: control.forecastStatus,
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/geo+json",
      headers: { "access-control-allow-origin": "*" },
      body: body(),
    });
  };
  return { handler, control };
}
