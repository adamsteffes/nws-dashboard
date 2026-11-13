import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNwsClient } from "../../src/nws/client";
import {
  type Forecast,
  fetchForecast,
  fetchHourly,
  nextHours,
  parseForecast,
} from "../../src/nws/forecast";
import { createFakeFetch } from "../helpers/fakeFetch";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "fixtures", "nws", `${name}.json`),
      "utf-8",
    ),
  );

const wrap = (periods: unknown[]) => ({ properties: { periods } });

describe("parseForecast", () => {
  it("parses the recorded 7-day forecast", () => {
    const forecast = parseForecast(fixture("forecast_linn-ks"));
    expect(forecast.periods.length).toBeGreaterThanOrEqual(13);
    for (const p of forecast.periods) {
      expect(p.name).not.toBe("");
      expect(Number.isNaN(Date.parse(p.startTime))).toBe(false);
    }
    expect(forecast.periods[0]).toMatchObject({
      number: 1,
      name: "Overnight",
      isDaytime: false,
      temperature: 26,
      temperatureTrend: null,
      precipChance: 0,
    });
    expect(forecast.generatedAt).not.toBeNull();
    expect(forecast.updated).not.toBeNull();
  });

  it("parses the recorded hourly forecast", () => {
    const forecast = parseForecast(fixture("forecast_hourly_linn-ks"));
    expect(forecast.periods.length).toBeGreaterThanOrEqual(48);
    const starts = forecast.periods.map((p) => Date.parse(p.startTime));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("parses the Miami fixtures", () => {
    expect(
      parseForecast(fixture("forecast_miami-fl")).periods.length,
    ).toBeGreaterThanOrEqual(13);
    expect(
      parseForecast(fixture("forecast_hourly_miami-fl")).periods.length,
    ).toBeGreaterThanOrEqual(48);
  });

  it("maps missing precipitation values to null", () => {
    const base = { startTime: "2026-11-13T02:00:00-06:00", temperature: 40 };
    const forecast = parseForecast(
      wrap([
        { ...base, probabilityOfPrecipitation: null },
        { ...base, probabilityOfPrecipitation: { value: null } },
        {
          ...base,
          probabilityOfPrecipitation: {
            unitCode: "wmoUnit:percent",
            value: 30,
          },
        },
        base,
      ]),
    );
    expect(forecast.periods.map((p) => p.precipChance)).toEqual([
      null,
      null,
      30,
      null,
    ]);
  });

  it("converts Celsius to rounded Fahrenheit", () => {
    const forecast = parseForecast(
      wrap([
        { startTime: "a", temperature: 20, temperatureUnit: "C" },
        { startTime: "b", temperature: -5, temperatureUnit: "C" },
        { startTime: "c", temperature: 70, temperatureUnit: "F" },
      ]),
    );
    expect(forecast.periods.map((p) => p.temperature)).toEqual([68, 23, 70]);
  });

  it("skips periods without startTime and keeps order", () => {
    const forecast = parseForecast(
      wrap([
        { startTime: "2026-11-13T01:00:00Z", name: "A" },
        { name: "no start" },
        null,
        { startTime: "2026-11-13T02:00:00Z", name: "B" },
      ]),
    );
    expect(forecast.periods.map((p) => p.name)).toEqual(["A", "B"]);
  });

  it("throws when periods is missing", () => {
    expect(() => parseForecast({ properties: {} })).toThrow("missing periods");
    expect(() => parseForecast(null)).toThrow("missing periods");
  });
});

describe("fetchForecast and fetchHourly", () => {
  const url = "https://api.weather.gov/gridpoints/TOP/32,81/forecast";
  const hourlyUrl = `${url}/hourly`;

  it("returns parsed forecasts", async () => {
    const client = createNwsClient({
      fetchFn: createFakeFetch({
        [url]: "forecast_linn-ks",
        [hourlyUrl]: "forecast_hourly_linn-ks",
      }),
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
    const daily = await fetchForecast(client, url);
    const hourly = await fetchHourly(client, hourlyUrl, { refresh: true });
    expect(daily.data.periods.length).toBeGreaterThanOrEqual(13);
    expect(hourly.data.periods.length).toBeGreaterThanOrEqual(48);
    expect(daily.stale).toBe(false);
  });
});

describe("nextHours", () => {
  const forecast = parseForecast(fixture("forecast_hourly_linn-ks"));
  const now = new Date("2026-11-13T10:30:00-06:00");

  it("returns periods that have not ended, limited to 48 by default", () => {
    const result = nextHours(forecast, now);
    expect(result).toHaveLength(48);
    expect(result[0]?.startTime).toBe("2026-11-13T10:00:00-06:00");
    for (const p of result) {
      expect(Date.parse(p.endTime)).toBeGreaterThan(now.getTime());
    }
  });

  it("respects the hours argument and exhausted forecasts", () => {
    expect(nextHours(forecast, now, 6)).toHaveLength(6);
    const empty: Forecast = { updated: null, generatedAt: null, periods: [] };
    expect(nextHours(empty, now)).toEqual([]);
    expect(nextHours(forecast, new Date("2027-01-01T00:00:00Z"))).toEqual([]);
  });
});
