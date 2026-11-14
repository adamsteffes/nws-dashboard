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
