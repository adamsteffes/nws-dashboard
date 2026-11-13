import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNwsClient } from "../../src/nws/client";
import { NwsNotFound } from "../../src/nws/errors";
import {
  fetchStations,
  parsePoint,
  parseStations,
  pointUrl,
  resolvePoint,
  roundCoord,
} from "../../src/nws/points";
import { createFakeFetch, type Routes } from "../helpers/fakeFetch";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "fixtures", "nws", `${name}.json`),
      "utf-8",
    ),
  );

const LINN = "https://api.weather.gov/points/39.7456,-97.0892";
const STATIONS = "https://api.weather.gov/gridpoints/TOP/32,81/stations";

function setup(routes: Routes) {
  const fetchFn = createFakeFetch(routes);
  const client = createNwsClient({
    fetchFn,
    isOnline: () => true,
    sleep: async () => {},
    lastGood: {
      async get() {
        return undefined;
      },
      async put() {},
      async prune() {},
      async deleteByPrefix() {},
      async clear() {},
    },
  });
  return { fetchFn, client };
}

type PointJson = { properties: Record<string, unknown> };
const linnCopy = () => structuredClone(fixture("points_linn-ks")) as PointJson;

describe("parsePoint", () => {
  it("parses the recorded Linn, KS point", () => {
    expect(parsePoint(fixture("points_linn-ks"))).toEqual({
      gridId: "TOP",
      gridX: 32,
      gridY: 81,
      cwa: "TOP",
      forecastUrl: "https://api.weather.gov/gridpoints/TOP/32,81/forecast",
      forecastHourlyUrl:
        "https://api.weather.gov/gridpoints/TOP/32,81/forecast/hourly",
      observationStationsUrl: STATIONS,
      forecastZone: "KSZ009",
      county: "KSC201",
      radarStation: "KTWX",
      timeZone: "America/Chicago",
      city: "Linn",
      state: "KS",
    });
  });

  it("parses the recorded Miami, FL point", () => {
    const info = parsePoint(fixture("points_miami-fl"));
    expect(info.state).toBe("FL");
    expect(info.forecastZone).toMatch(/^[A-Z]{2}Z\d{3}$/);
    expect(info.timeZone).toBe("America/New_York");
  });

  it("omits county when absent", () => {
    const json = linnCopy();
    delete json.properties.county;
    expect(parsePoint(json)).not.toHaveProperty("county");
  });

  it.each([
    ["gridId", "gridId"],
    ["gridX", "gridX"],
    ["forecast", "forecast"],
    ["forecastHourly", "forecastHourly"],
    ["observationStations", "observationStations"],
    ["forecastZone", "forecastZone"],
    ["radarStation", "radarStation"],
    ["timeZone", "timeZone"],
    ["cwa", "cwa"],
    ["relativeLocation", "relativeLocation.properties"],
  ])("throws a clear error when %s is missing", (key, label) => {
    const json = linnCopy();
    delete json.properties[key];
    expect(() => parsePoint(json)).toThrow(
      `Unexpected /points response: missing ${label}`,
    );
  });

  it("throws on a wrong-typed field", () => {
    const json = linnCopy();
    json.properties.gridX = "32";
    expect(() => parsePoint(json)).toThrow("missing gridX");
  });

  it("throws on non-object input", () => {
    expect(() => parsePoint(null)).toThrow("missing properties");
    expect(() => parsePoint("x")).toThrow("missing properties");
  });
});

describe("roundCoord and pointUrl", () => {
  it("rounds to 4 decimals", () => {
    expect(roundCoord(39.74561234)).toBe(39.7456);
    expect(roundCoord(-97.08924)).toBe(-97.0892);
  });

  it("builds URLs without trailing zeros", () => {
    expect(pointUrl(39.74561234, -97.08924)).toBe(LINN);
    expect(pointUrl(39.5, -97)).toBe("https://api.weather.gov/points/39.5,-97");
  });
});

describe("resolvePoint", () => {
  it("requests the rounded point URL and parses it", async () => {
    const { fetchFn, client } = setup({ [LINN]: "points_linn-ks" });
    const res = await resolvePoint(client, 39.74561234, -97.08924);
    expect(fetchFn.calls.map((c) => c.url)).toEqual([LINN]);
    expect(res.data.gridId).toBe("TOP");
    expect(res.stale).toBe(false);
  });

  it.each([
    [91, 0],
    [-90.5, 0],
    [0, 181],
    [0, -180.1],
    [Number.NaN, 0],
  ])("rejects %s,%s without fetching", async (lat, lon) => {
    const { fetchFn, client } = setup({});
    await expect(resolvePoint(client, lat, lon)).rejects.toBeInstanceOf(
      RangeError,
    );
    expect(fetchFn.calls).toHaveLength(0);
  });

  it("propagates NwsNotFound for points outside coverage", async () => {
    const { client } = setup({
      "https://api.weather.gov/points/0,0": "points_404",
    });
    await expect(resolvePoint(client, 0, 0)).rejects.toBeInstanceOf(
      NwsNotFound,
    );
  });
});

describe("stations", () => {
  it("parses station identifiers in order", () => {
    const ids = parseStations(fixture("stations_linn-ks"));
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(ids.slice(0, 3)).toEqual(["KMYZ", "KCNK", "KHJH"]);
  });

  it("throws when features is missing", () => {
    expect(() => parseStations({})).toThrow("missing features");
  });

  it("fetches only the first 3 by default", async () => {
    const { client } = setup({ [STATIONS]: "stations_linn-ks" });
    const res = await fetchStations(client, STATIONS);
    expect(res.data).toEqual(["KMYZ", "KCNK", "KHJH"]);
  });

  it("honours a custom limit", async () => {
    const { client } = setup({ [STATIONS]: "stations_linn-ks" });
    const res = await fetchStations(client, STATIONS, 1);
    expect(res.data).toEqual(["KMYZ"]);
  });
});
