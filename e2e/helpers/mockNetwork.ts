import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";

export type RouteHandler = (route: Route) => Promise<void> | void;

export interface MockRoutes {
  nws?: RouteHandler;
  radar?: RouteHandler;
  nominatim?: RouteHandler;
}

const radarGif = readFileSync(
  new URL("../../tests/fixtures/radar/sample.gif", import.meta.url),
);

const defaults: Required<MockRoutes> = {
  nws: (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/problem+json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        type: "https://api.weather.gov/problems/NotFound",
        title: "Not Found",
        status: 404,
        detail: "Mocked: no fixture registered for this request",
      }),
    }),
  radar: (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/gif",
      headers: { "access-control-allow-origin": "*" },
      body: radarGif,
    }),
  nominatim: (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "[]",
    }),
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface NetworkMock {
  /** URLs of non-local requests that matched no mock and were aborted. */
  unmocked: string[];
  expectNoUnmockedRequests(): void;
}

export async function mockNetwork(
  page: Page,
  routes: MockRoutes = {},
): Promise<NetworkMock> {
  const handlers = { ...defaults, ...routes };
  const unmocked: string[] = [];

  await page.route("https://api.weather.gov/**", handlers.nws);
  await page.route("https://radar.weather.gov/**", handlers.radar);
  await page.route(
    "https://nominatim.openstreetmap.org/**",
    handlers.nominatim,
  );

  // Registered last so it runs first; it only claims requests that no
  // specific mock covers and falls back to the specific handlers otherwise.
  await page.route(
    (url) =>
      !LOCAL_HOSTS.has(url.hostname) &&
      url.protocol !== "data:" &&
      url.protocol !== "blob:" &&
      url.protocol !== "about:",
    (route) => {
      const { hostname } = new URL(route.request().url());
      if (
        hostname === "api.weather.gov" ||
        hostname === "radar.weather.gov" ||
        hostname === "nominatim.openstreetmap.org"
      ) {
        return route.fallback();
      }
      unmocked.push(route.request().url());
      return route.abort();
    },
  );

  return {
    unmocked,
    expectNoUnmockedRequests() {
      if (unmocked.length > 0) {
        throw new Error(
          `Unmocked network requests attempted:\n${unmocked.join("\n")}`,
        );
      }
    },
  };
}
