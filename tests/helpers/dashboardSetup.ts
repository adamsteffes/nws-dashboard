import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAppContext } from "../../src/app/context";
import { alertsUrl } from "../../src/nws/alerts";
import { createNwsClient } from "../../src/nws/client";
import { latestObservationUrl } from "../../src/nws/observations";
import { parsePoint, parseStations } from "../../src/nws/points";
import type { LastGood, LastGoodEntry } from "../../src/store/lastGood";
import {
  createLocationStore,
  metaFromPoint,
  type NwsMeta,
} from "../../src/store/locations";
import { createFakeFetch, type Routes } from "./fakeFetch";
import { createMemoryStorage } from "./memoryStorage";

export const NOW = new Date("2026-11-13T08:00:00Z");
export const LINN = { lat: 39.7456, lon: -97.0892 };
export const POINT_URL = "https://api.weather.gov/points/39.7456,-97.0892";
export const STATIONS_URL =
  "https://api.weather.gov/gridpoints/TOP/32,81/stations";
export const FORECAST_URL =
  "https://api.weather.gov/gridpoints/TOP/32,81/forecast";
export const HOURLY_URL = `${FORECAST_URL}/hourly`;
export const ALERTS_URL = alertsUrl(LINN.lat, LINN.lon);
export const KMYZ_URL = latestObservationUrl("KMYZ");
export const KCNK_URL = latestObservationUrl("KCNK");

const readFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "fixtures", "nws", `${name}.json`),
      "utf-8",
    ),
  );

export function linnMeta(): NwsMeta {
  return metaFromPoint(
    parsePoint(readFixture("points_linn-ks")),
    parseStations(readFixture("stations_linn-ks")).slice(0, 3),
    NOW,
  );
}

export const linnRoutes = (): Routes => ({
  [POINT_URL]: "points_linn-ks",
  [STATIONS_URL]: "stations_linn-ks",
  [FORECAST_URL]: "forecast_linn-ks",
  [HOURLY_URL]: "forecast_hourly_linn-ks",
  [ALERTS_URL]: "alerts_active_linn-ks",
  [KMYZ_URL]: "obs_latest_linn-ks_KMYZ",
  [KCNK_URL]: "obs_latest_linn-ks_KCNK",
});

/** In-memory last-good store; entries can be shared between clients. */
export function fakeLastGood() {
  const entries = new Map<string, LastGoodEntry<unknown>>();
  const lastGood: LastGood = {
    async get<T>(key: string) {
      return entries.get(key) as LastGoodEntry<T> | undefined;
    },
    async put<T>(key: string, value: T, ttlMs: number) {
      entries.set(key, {
        value,
        fetchedAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + ttlMs).toISOString(),
      });
    },
    async prune() {},
    async deleteByPrefix() {},
    async clear() {
      entries.clear();
    },
  };
  return { lastGood, entries };
}

export type DashboardSetupOptions = {
  routes?: Routes;
  online?: boolean;
  withMeta?: boolean;
  lastGood?: LastGood;
};

export function dashboardSetup(options: DashboardSetupOptions = {}) {
  const store = createLocationStore({ storage: createMemoryStorage() });
  const location = store.add({
    name: "Linn",
    ...LINN,
    ...(options.withMeta === false ? {} : { nws: linnMeta() }),
  });
  const fetchFn = createFakeFetch(options.routes ?? linnRoutes());
  const lastGood = options.lastGood ?? fakeLastGood().lastGood;
  let online = options.online ?? true;
  const client = createNwsClient({
    fetchFn,
    isOnline: () => online,
    sleep: async () => {},
    lastGood,
  });
  const ctx = createAppContext({
    store,
    client,
    lastGood,
    now: () => NOW,
  });
  return {
    ctx,
    store,
    location,
    fetchFn,
    isOnline: () => online,
    setOnline(value: boolean) {
      online = value;
    },
    count: (url: string) => fetchFn.calls.filter((c) => c.url === url).length,
  };
}
