import { render } from "lit-html";
import { describe, expect, it } from "vitest";
import type { DashboardItem } from "../../src/app/dashboardController";
import type { Alert } from "../../src/nws/alerts";
import type { ForecastPeriod } from "../../src/nws/forecast";
import type { LatestObservation } from "../../src/nws/observations";
import { CONUS_LOOP } from "../../src/nws/radar";
import {
  type LocationSummary,
  loadingSummary,
  type Panel,
} from "../../src/services/panels";
import type { SavedLocation } from "../../src/store/locations";
import { alertBadgeText, dashboardView } from "../../src/views/dashboard";
import { linnMeta, NOW } from "../helpers/dashboardSetup";

const EVIL = `<img src=x onerror="alert(1)">`;

const location = (over: Partial<SavedLocation> = {}): SavedLocation => ({
  id: "linn",
  name: "Linn",
  lat: 39.7456,
  lon: -97.0892,
  createdAt: NOW.toISOString(),
  nws: linnMeta(),
  ...over,
});

const alert = (severity: Alert["severity"]): Alert => ({
  id: `a-${severity}`,
  event: "Test",
  severity,
  certainty: "Likely",
  urgency: "Expected",
  headline: null,
  description: "",
  instruction: null,
  effective: null,
  onset: null,
  expires: null,
  ends: null,
  senderName: "NWS",
  areaDesc: "Linn",
});

function observation(
  over: Partial<LatestObservation["data"]> = {},
  tooOld = false,
): LatestObservation {
  return {
    data: {
      stationId: "KMYZ",
      timestamp: new Date(NOW.getTime() - 12 * 60_000).toISOString(),
      textDescription: "Mostly Cloudy",
      icon: null,
      temperatureF: 72,
      dewpointF: null,
      humidity: null,
      windMph: null,
      windGustMph: null,
      windDirection: null,
      pressureInHg: null,
      visibilityMi: null,
      heatIndexF: null,
      windChillF: null,
      feelsLikeF: 75,
      ...over,
    },
    fetchedAt: NOW.toISOString(),
    stale: false,
    usedFallback: false,
    ageMinutes: 12,
    tooOld,
  };
}

const period = (over: Partial<ForecastPeriod> = {}): ForecastPeriod => ({
  number: 1,
  name: "Tonight",
  startTime: NOW.toISOString(),
  endTime: NOW.toISOString(),
  isDaytime: false,
  temperature: 50,
  temperatureTrend: null,
  precipChance: 5,
  windSpeed: "5 mph",
  windDirection: "N",
  icon: null,
  shortForecast: "Clear",
  detailedForecast: "",
  ...over,
});

const ok = <T>(data: T): Panel<T> => ({
  status: "ok",
  data,
  fetchedAt: NOW.toISOString(),
});

function mount(
  summary: Partial<LocationSummary> = {},
  loc: SavedLocation = location(),
) {
  const item: DashboardItem = {
    location: loc,
    summary: {
      alerts: ok<Alert[]>([]),
      current: ok(observation()),
      forecast: ok([period(), period({ name: "Friday" })]),
      ...summary,
    },
  };
  const el = document.createElement("div");
  render(dashboardView({ items: [item], now: NOW }), el);
  return el;
}

describe("dashboardView", () => {
  it("shows the empty state", () => {
    const el = document.createElement("div");
    render(dashboardView({ items: [], now: NOW }), el);
    expect(el.textContent).toContain("No locations yet");
    expect(el.querySelector(".grid")).toBeNull();
  });

  it("renders one card per location in order, linked by a single heading link", () => {
    const el = document.createElement("div");
    const items = [
      { location: location({ id: "b", name: "B" }), summary: loadingSummary() },
      { location: location({ id: "a", name: "A" }), summary: loadingSummary() },
    ];
    render(dashboardView({ items, now: NOW }), el);
    const links = [...el.querySelectorAll(".grid h2 a")];
    expect(links.map((a) => a.textContent)).toEqual(["B", "A"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "#/l/b",
      "#/l/a",
    ]);
    expect(el.querySelectorAll("a")).toHaveLength(2);
  });

  it("shows the name and city", () => {
    const el = mount();
    expect(el.querySelector("h2")?.textContent).toBe("Linn");
    expect(el.textContent).toContain("Linn, KS");
  });

  it("shows current conditions with age", () => {
    const el = mount();
    expect(el.querySelector(".wx-temp")?.textContent).toBe("72°");
    expect(el.textContent).toContain("Mostly Cloudy");
    expect(el.textContent).toContain("Feels like 75°");
    expect(el.textContent).toContain("Updated 12 min ago");
    expect(el.textContent).not.toContain("Reading is old");
  });

  it("hides feels-like when it equals the temperature", () => {
    const el = mount({ current: ok(observation({ feelsLikeF: 72 })) });
    expect(el.textContent).not.toContain("Feels like");
  });

  it("flags an old reading", () => {
    const el = mount({ current: ok(observation({}, true)) });
    expect(el.textContent).toContain("Reading is old");
  });

  it("shows the next forecast periods with precipitation only from 10%", () => {
    const el = mount({
      forecast: ok([
        period({ precipChance: 40, shortForecast: "Showers" }),
        period({ name: "Friday", temperature: 61, precipChance: 9 }),
      ]),
    });
    const items = [...el.querySelectorAll(".wx-periods li")];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("Tonight");
    expect(items[0]?.textContent).toContain("50°");
    expect(items[0]?.textContent).toContain("Showers");
    expect(items[0]?.textContent).toContain("Precip 40%");
    expect(items[1]?.textContent).toContain("61°");
    expect(items[1]?.textContent).not.toContain("Precip");
  });

  describe("alert badge", () => {
    it("is absent without alerts", () => {
      expect(mount().querySelector(".wx-badge")).toBeNull();
    });

    it("carries the count and highest level as text", () => {
      const el = mount({
        alerts: ok([alert("Minor"), alert("Extreme"), alert("Moderate")]),
      });
      const badge = el.querySelector(".wx-badge");
      expect(badge?.textContent?.trim()).toBe("3 alerts · Extreme");
      expect(badge?.classList.contains("severity-extreme")).toBe(true);
    });

    it("uses the singular and spells out unknown severity", () => {
      expect(alertBadgeText([alert("Severe")])).toBe("1 alert · Severe");
      expect(alertBadgeText([alert("Unknown")])).toBe(
        "1 alert · Severity unknown",
      );
    });
  });

  describe("panel states", () => {
    it("shows loading per panel", () => {
      const el = mount({ forecast: { status: "loading" } });
      expect(el.textContent).toContain("Forecast: Loading…");
      expect(el.querySelector(".wx-temp")?.textContent).toBe("72°");
    });

    it("shows an error for one panel and keeps the rest", () => {
      const el = mount({
        forecast: { status: "error", error: "Weather Service unavailable" },
      });
      expect(el.querySelector(".error")?.textContent).toBe(
        "Forecast: Weather Service unavailable",
      );
      expect(el.querySelector(".wx-temp")?.textContent).toBe("72°");
      expect(el.querySelector("h2")?.textContent).toBe("Linn");
    });

    it("notes stale data in the location's time zone", () => {
      const el = mount({
        forecast: {
          status: "stale",
          data: [period()],
          fetchedAt: "2026-11-13T21:05:00Z",
        },
      });
      // America/Chicago is UTC-6 in November.
      expect(el.textContent).toContain("Showing saved data from 3:05 PM");
      expect(el.querySelectorAll(".wx-periods li")).toHaveLength(1);
    });
  });

  describe("radar", () => {
    it("shows a lazy thumbnail with alt text and a size", () => {
      const img = mount().querySelector("img");
      expect(img?.getAttribute("src")).toBe(
        "https://radar.weather.gov/ridge/standard/KTWX_0.gif",
      );
      expect(img?.getAttribute("alt")).toBe("Radar for Linn");
      expect(img?.getAttribute("loading")).toBe("lazy");
      expect(img?.getAttribute("width")).toBeTruthy();
      expect(img?.getAttribute("height")).toBeTruthy();
    });

    it("is omitted without a radar station", () => {
      const meta = { ...linnMeta(), radarStation: null };
      expect(
        mount({}, location({ nws: meta })).querySelector("img"),
      ).toBeNull();
    });

    it("falls back to the nationwide loop once", () => {
      const img = mount().querySelector("img") as HTMLImageElement;
      img.dispatchEvent(new Event("error"));
      expect(img.getAttribute("src")).toBe(CONUS_LOOP);
      img.dispatchEvent(new Event("error"));
      expect(img.getAttribute("src")).toBe(CONUS_LOOP);
      expect(img.dataset.fallback).toBe("1");
    });
  });

  it("escapes names and Weather Service text", () => {
    const meta = { ...linnMeta(), city: EVIL };
    const el = mount(
      {
        current: ok(observation({ textDescription: EVIL })),
        forecast: ok([period({ name: EVIL, shortForecast: EVIL })]),
      },
      location({ name: EVIL, nws: meta }),
    );
    expect(el.querySelector("h2 a")?.textContent).toBe(EVIL);
    expect(el.querySelector(".wx-desc")?.textContent).toBe(EVIL);
    expect(el.querySelector(".wx-period-name")?.textContent).toBe(EVIL);
    expect(el.querySelectorAll("img")).toHaveLength(1);
    expect(el.querySelector("img")?.getAttribute("alt")).toBe(
      `Radar for ${EVIL}`,
    );
  });
});
