import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNwsClient } from "../../src/nws/client";
import { NwsError, NwsNotFound } from "../../src/nws/errors";
import {
  fetchLatestObservation,
  latestObservationUrl,
  parseObservation,
} from "../../src/nws/observations";
import { _resetUnitWarnings } from "../../src/nws/units";
import type { LastGood } from "../../src/store/lastGood";
import { createFakeFetch, type Routes } from "../helpers/fakeFetch";

const FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures", "nws");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf-8"));

const COMPASS = /^(N|NNE|NE|ENE|E|ESE|SE|SSE|S|SSW|SW|WSW|W|WNW|NW|NNW)$/;
const NOW = new Date("2026-11-13T12:00:00Z");

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  _resetUnitWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

const recorded = readdirSync(FIXTURE_DIR)
  .filter((f) => /^obs_latest_.*_[A-Z]+\.json$/.test(f))
  .map((f) => f.replace(/\.json$/, ""));

describe("parseObservation", () => {
  it("covers the recorded fixtures", () => {
    expect(recorded).toHaveLength(4);
  });

  it.each(recorded)("parses %s without unit warnings", (name) => {
    const obs = parseObservation(fixture(name));
    expect(
      obs.temperatureF === null || typeof obs.temperatureF === "number",
    ).toBe(true);
    if (obs.windDirection !== null) expect(obs.windDirection).toMatch(COMPASS);
    expect(obs.stationId).not.toBe("");
    expect(warn).not.toHaveBeenCalled();
  });

  it("converts and rounds a recorded observation", () => {
    const obs = parseObservation(fixture("obs_latest_miami-fl_KMIA"));
    expect(obs.stationId).toBe("KMIA");
    expect(obs.temperatureF).toBe(75);
    expect(obs.heatIndexF).toBe(76);
    expect(obs.windChillF).toBeNull();
    // The API's heat index does not apply at 75 F.
    expect(obs.feelsLikeF).toBe(75);
    expect(obs.windDirection).toBe("NW");
    expect(Number.isInteger(obs.windMph)).toBe(true);
  });

  it("returns all-null numerics for the nulls fixture", () => {
    const obs = parseObservation(fixture("obs_latest_nulls"));
    expect(obs.stationId).toBe("KTST");
    expect(obs.icon).toBeNull();
    expect(obs.textDescription).toBe("");
    for (const key of [
      "temperatureF",
      "dewpointF",
      "humidity",
      "windMph",
      "windGustMph",
      "windDirection",
      "pressureInHg",
      "visibilityMi",
      "heatIndexF",
      "windChillF",
      "feelsLikeF",
    ] as const) {
      expect(obs[key]).toBeNull();
    }
  });

  it("prefers the explicit station id over the station URL", () => {
    expect(
      parseObservation(fixture("obs_latest_nulls"), "KABC").stationId,
    ).toBe("KABC");
  });

  describe("feelsLike thresholds", () => {
    const q = (value: number | null, unitCode = "wmoUnit:degF") => ({
      unitCode,
      value,
    });
    const build = (
      temperature: number | null,
      heatIndex: number | null,
      windChill: number | null,
      windMph: number | null,
    ) =>
      parseObservation({
        properties: {
          temperature: q(temperature),
          heatIndex: q(heatIndex),
          windChill: q(windChill),
          windSpeed: q(windMph, "wmoUnit:km_h-1"),
        },
      }).feelsLikeF;
    const kmh = (mph: number) => mph * 1.609344;

    it("uses heat index at 80 F and above", () => {
      expect(build(80, 85, null, kmh(5))).toBe(85);
      expect(build(79, 85, null, kmh(5))).toBe(79);
    });

    it("uses wind chill at 50 F and below with wind over 3 mph", () => {
      expect(build(50, null, 45, kmh(10))).toBe(45);
      expect(build(51, null, 45, kmh(10))).toBe(51);
      expect(build(40, null, 35, kmh(3))).toBe(40);
      expect(build(40, null, 35, kmh(4))).toBe(35);
      expect(build(40, null, 35, null)).toBe(40);
    });

    it("falls back to temperature, or null without one", () => {
      expect(build(65, null, null, kmh(5))).toBe(65);
      expect(build(90, null, null, kmh(5))).toBe(90);
      expect(build(null, 95, 20, kmh(10))).toBeNull();
    });
  });

  it("reports no wind direction when the wind is calm", () => {
    const wind = (kmh: number) =>
      parseObservation({
        properties: {
          windSpeed: { unitCode: "wmoUnit:km_h-1", value: kmh },
          windDirection: { unitCode: "wmoUnit:degree_(angle)", value: 90 },
        },
      });
    expect(wind(0).windMph).toBe(0);
    expect(wind(0).windDirection).toBeNull();
    expect(wind(0.5).windMph).toBe(0);
    expect(wind(0.5).windDirection).toBeNull();
    expect(wind(10).windDirection).toBe("E");
  });

  it("never returns negative zero", () => {
    const at = (value: number) =>
      parseObservation({
        properties: { temperature: { unitCode: "wmoUnit:degF", value } },
      });
    expect(Object.is(at(-0.2).temperatureF, 0)).toBe(true);
    expect(at(-5).temperatureF).toBe(-5);
  });
});

describe("latestObservationUrl", () => {
  it("builds the station URL", () => {
    expect(latestObservationUrl("KCNK")).toBe(
      "https://api.weather.gov/stations/KCNK/observations/latest",
    );
  });
});

describe("fetchLatestObservation", () => {
  const noStore: LastGood = {
    async get() {
      return undefined;
    },
    async put() {},
    async prune() {},
    async deleteByPrefix() {},
    async clear() {},
  };

  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

  function obsBody(stationId: string, temperatureC: number | null, at: Date) {
    return {
      properties: {
        stationId,
        timestamp: at.toISOString(),
        textDescription: "Clear",
        temperature: { unitCode: "wmoUnit:degC", value: temperatureC },
      },
    };
  }

  const ok = (body: unknown) => ({ status: 200, body });
  const url = latestObservationUrl;

  function setup(routes: Routes, lastGood: LastGood = noStore) {
    const fetchFn = createFakeFetch(routes);
    const client = createNwsClient({
      fetchFn,
      lastGood,
      isOnline: () => true,
      sleep: async () => {},
    });
    return { client, fetchFn };
  }

  it("uses the first station when it is fresh", async () => {
    const { client, fetchFn } = setup({
      [url("A")]: ok(obsBody("A", 20, minutesAgo(30))),
      [url("B")]: ok(obsBody("B", 10, minutesAgo(5))),
    });
    const res = await fetchLatestObservation(client, ["A", "B"], NOW);
    expect(res.data.stationId).toBe("A");
    expect(res.data.temperatureF).toBe(68);
    expect(res.usedFallback).toBe(false);
    expect(res.tooOld).toBe(false);
    expect(res.ageMinutes).toBe(30);
    expect(res.stale).toBe(false);
    // Stations are fetched concurrently, so the second is requested too.
    expect(fetchFn.calls).toHaveLength(2);
  });

  it("falls back when the first station has no temperature", async () => {
    const { client } = setup({
      [url("A")]: ok(obsBody("A", null, minutesAgo(5))),
      [url("B")]: ok(obsBody("B", 10, minutesAgo(40))),
    });
    const res = await fetchLatestObservation(client, ["A", "B"], NOW);
    expect(res.data.stationId).toBe("B");
    expect(res.usedFallback).toBe(true);
    expect(res.tooOld).toBe(false);
  });

  it("accepts an observation exactly 120 minutes old", async () => {
    const { client } = setup({
      [url("A")]: ok(obsBody("A", 20, minutesAgo(120))),
    });
    const res = await fetchLatestObservation(client, ["A"], NOW);
    expect(res.tooOld).toBe(false);
  });

  it("returns the freshest observation flagged tooOld when all are old", async () => {
    const { client } = setup({
      [url("A")]: ok(obsBody("A", 20, minutesAgo(300))),
      [url("B")]: ok(obsBody("B", 10, minutesAgo(180))),
    });
    const res = await fetchLatestObservation(client, ["A", "B"], NOW);
    expect(res.data.stationId).toBe("B");
    expect(res.usedFallback).toBe(true);
    expect(res.tooOld).toBe(true);
    expect(res.ageMinutes).toBe(180);
  });

  it("returns the freshest when every temperature is null", async () => {
    const { client } = setup({
      [url("A")]: ok(obsBody("A", null, minutesAgo(50))),
      [url("B")]: ok(obsBody("B", null, minutesAgo(10))),
    });
    const res = await fetchLatestObservation(client, ["A", "B"], NOW);
    expect(res.data.stationId).toBe("B");
    expect(res.tooOld).toBe(true);
    expect(res.data.temperatureF).toBeNull();
  });

  it("prefers an old reading with a temperature over a recent empty one", async () => {
    const { client } = setup({
      [url("A")]: ok(obsBody("A", null, minutesAgo(10))),
      [url("B")]: ok(obsBody("B", 10, minutesAgo(300))),
    });
    const res = await fetchLatestObservation(client, ["A", "B"], NOW);
    expect(res.data.stationId).toBe("B");
    expect(res.tooOld).toBe(true);
    expect(res.ageMinutes).toBe(300);
  });

  describe("last-good fallback", () => {
    const storing = (stored: Record<string, unknown>): LastGood => ({
      ...noStore,
      async get<T>(key: string) {
        const value = stored[key];
        if (value === undefined) return undefined;
        return {
          value: value as T,
          fetchedAt: "2026-11-13T09:00:00.000Z",
          expiresAt: "2026-11-13T09:05:00.000Z",
        };
      },
    });

    it("passes stale through and computes age from the observation time", async () => {
      const { client } = setup(
        { [url("A")]: [503, 503, 503] },
        storing({ [url("A")]: obsBody("A", 20, minutesAgo(45)) }),
      );
      const res = await fetchLatestObservation(client, ["A"], NOW);
      expect(res.stale).toBe(true);
      expect(res.ageMinutes).toBe(45);
      expect(res.tooOld).toBe(false);
    });

    it("lets a fresh live station beat an old stored reading", async () => {
      const { client } = setup(
        {
          [url("A")]: [503, 503, 503],
          [url("B")]: ok(obsBody("B", 10, minutesAgo(5))),
        },
        storing({ [url("A")]: obsBody("A", 20, minutesAgo(200)) }),
      );
      const res = await fetchLatestObservation(client, ["A", "B"], NOW);
      expect(res.data.stationId).toBe("B");
      expect(res.stale).toBe(false);
      expect(res.usedFallback).toBe(true);
      expect(res.tooOld).toBe(false);
    });
  });

  it("skips a station that keeps failing", async () => {
    const { client, fetchFn } = setup({
      [url("A")]: [503, 503, 503],
      [url("B")]: ok(obsBody("B", 10, minutesAgo(5))),
    });
    const res = await fetchLatestObservation(client, ["A", "B"], NOW);
    expect(res.data.stationId).toBe("B");
    expect(res.usedFallback).toBe(true);
    expect(fetchFn.calls).toHaveLength(4);
  });

  it("skips a station that is not found", async () => {
    const { client } = setup({
      [url("A")]: 404,
      [url("B")]: ok(obsBody("B", 10, minutesAgo(5))),
    });
    const res = await fetchLatestObservation(client, ["A", "B"], NOW);
    expect(res.data.stationId).toBe("B");
  });

  it("rethrows the last error when every station fails", async () => {
    const { client } = setup({
      [url("A")]: 404,
      [url("B")]: [503, 503, 503],
    });
    const error = await fetchLatestObservation(client, ["A", "B"], NOW).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NwsError);
    expect(error).not.toBeInstanceOf(NwsNotFound);
    expect((error as NwsError).status).toBe(503);
  });

  it("throws for an empty station list", async () => {
    const { client } = setup({});
    await expect(fetchLatestObservation(client, [], NOW)).rejects.toThrow(
      "No observation stations",
    );
  });
});
