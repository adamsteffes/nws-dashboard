import { render } from "lit-html";
import { describe, expect, it } from "vitest";
import type { LocationViewProps } from "../../src/app/locationController";
import type { Alert } from "../../src/nws/alerts";
import { CONUS_LOOP } from "../../src/nws/radar";
import {
  type LocationDetail,
  loadingDetail,
  loadLocationDetail,
} from "../../src/services/detail";
import type { SavedLocation } from "../../src/store/locations";
import { locationView, windText } from "../../src/views/location";
import {
  ALERTS_URL,
  dashboardSetup,
  HOURLY_URL,
  linnMeta,
  linnRoutes,
  NOW,
} from "../helpers/dashboardSetup";

async function loaded(
  routes = linnRoutes(),
): Promise<{ detail: LocationDetail; location: SavedLocation }> {
  const { ctx, location } = dashboardSetup({ routes });
  return { detail: await loadLocationDetail(ctx, location), location };
}

function mount(
  props: Partial<LocationViewProps> & { detail: LocationDetail },
  location?: SavedLocation,
) {
  const el = document.createElement("div");
  render(
    locationView({
      location,
      now: NOW,
      online: true,
      ...props,
    }),
    el,
  );
  return el;
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, " ").trim();

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: "a1",
  event: "Test Event",
  severity: "Minor",
  certainty: "Likely",
  urgency: "Expected",
  headline: null,
  description: "",
  instruction: null,
  effective: null,
  onset: null,
  expires: null,
  ends: null,
  senderName: "",
  areaDesc: "",
  ...over,
});

describe("locationView", () => {
  it("shows not-found for an unknown location", () => {
    const el = mount({ detail: loadingDetail() });
    expect(el.querySelector("h2")?.textContent).toBe("Location not found");
  });

  it("renders the header with place, coordinates and links", async () => {
    const { detail, location } = await loaded();
    const el = mount({ detail }, { ...location, name: "<b>Linn</b>" });
    expect(el.querySelector(".loc-detail-head h2")?.textContent).toBe(
      "<b>Linn</b>",
    );
    expect(el.querySelector(".loc-detail-head b")).toBeNull();
    expect(text(el.querySelector(".loc-detail-head p"))).toBe(
      "Linn, KS · 39.7456, -97.0892",
    );
    const links = [...el.querySelectorAll(".loc-detail-head a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "#/",
      "#/l/linn/afd",
    ]);
    expect(links[1]?.textContent).toBe("Forecast discussion");
  });

  it("omits the discussion link without a forecast office", async () => {
    const { detail, location } = await loaded();
    const { nws } = location;
    if (!nws) throw new Error("missing meta");
    const el = mount({ detail }, { ...location, nws: { ...nws, cwa: "" } });
    expect(el.querySelector('a[href$="/afd"]')).toBeNull();
    const bare = { ...location, nws: undefined };
    expect(
      mount({ detail: loadingDetail() }, bare).querySelector('a[href$="/afd"]'),
    ).toBeNull();
  });

  describe("alerts", () => {
    it("lists the most severe first with severity words and an until time", async () => {
      const routes = { ...linnRoutes(), [ALERTS_URL]: "alerts_active_multi" };
      const { detail, location } = await loaded(routes);
      const el = mount({ detail }, location);
      const items = [...el.querySelectorAll("details.alert-item")];
      expect(items.map((i) => text(i.querySelector(".alert-event")))).toEqual([
        "Tornado Warning",
        "Winter Weather Advisory",
        "Frost Advisory",
      ]);
      expect(items.map((i) => text(i.querySelector(".severity")))).toEqual([
        "Extreme",
        "Moderate",
        "Minor",
      ]);
      // Tornado Warning ends 2026-01-15 14:45 -06:00; the zone matches the device only by chance.
      expect(text(items[0]?.querySelector("summary"))).toMatch(
        /until Jan 15, (2:45 PM|8:45 PM)/,
      );
      expect(items.every((i) => !(i as HTMLDetailsElement).open)).toBe(true);
    });

    it("labels instructions and keeps line breaks", () => {
      const { detail } = { detail: { ...loadingDetail() } };
      detail.alerts = {
        status: "ok",
        data: [
          alert({
            headline: "Headline",
            areaDesc: "Linn; Washington",
            description: "Line one\n\nLine two",
            instruction: "Move indoors.",
            senderName: "NWS Topeka KS",
            effective: "2026-11-13T00:00:00Z",
          }),
        ],
      };
      const location: SavedLocation = {
        id: "linn",
        name: "Linn",
        lat: 1,
        lon: 2,
        createdAt: "x",
        nws: linnMeta(),
      };
      const el = mount({ detail }, location);
      const body = el.querySelector(".alert-body");
      expect(text(body?.querySelector("h4"))).toBe("What to do");
      expect(body?.querySelector(".pre-text")?.textContent).toBe(
        "Line one\n\nLine two",
      );
      expect(text(body)).toContain("Headline");
      expect(text(body)).toContain("Linn; Washington");
      expect(text(body)).toContain("NWS Topeka KS");
      expect(text(body?.querySelector("dl"))).toContain("Effective");
    });

    it("renders alert text as text, not markup", () => {
      const evil = `<script>window.__pwned = 1</script><img src=x onerror="alert(1)">`;
      const detail = loadingDetail();
      detail.alerts = {
        status: "ok",
        data: [alert({ event: evil, description: evil, instruction: evil })],
      };
      const el = mount(
        { detail },
        {
          id: "linn",
          name: "Linn",
          lat: 1,
          lon: 2,
          createdAt: "x",
        },
      );
      expect(el.querySelector("script")).toBeNull();
      expect(el.querySelector(".alert-body img")).toBeNull();
      expect(el.querySelector(".alert-event")?.textContent).toBe(evil);
    });

    it("says so when there are no alerts", async () => {
      const { detail, location } = await loaded();
      const el = mount({ detail }, location);
      expect(el.querySelector("details.alert-item")).toBeNull();
      expect(text(el.querySelector("#alerts-h")?.parentElement)).toContain(
        "No active alerts",
      );
    });

    it("shows unknown severity in words", () => {
      const detail = loadingDetail();
      detail.alerts = { status: "ok", data: [alert({ severity: "Unknown" })] };
      const el = mount(
        { detail },
        {
          id: "l",
          name: "L",
          lat: 1,
          lon: 2,
          createdAt: "x",
        },
      );
      expect(text(el.querySelector(".severity"))).toBe("Severity unknown");
    });
  });

  describe("current conditions", () => {
    it("shows the recorded reading", async () => {
      const { detail, location } = await loaded();
      const el = mount({ detail }, location);
      const section = el.querySelector("[aria-labelledby=current-h]");
      expect(text(section?.querySelector(".wx-desc"))).toBe("Clear");
      const facts = text(section?.querySelector("dl")) ?? "";
      for (const label of [
        "Dew point",
        "Humidity",
        "Wind",
        "Pressure",
        "Visibility",
        "StationKMYZ",
      ]) {
        expect(facts).toContain(label);
      }
      expect(facts).toMatch(/Pressure\d\d\.\d\d inHg/);
      expect(text(section?.querySelector(".wx-age"))).toMatch(
        /^Observed \d{1,2}:\d{2} (AM|PM)( [A-Z]{3})? \(25 min ago\)$/,
      );
      expect(section?.textContent).not.toContain("Reading is old");
    });

    it("shows a dash for every missing value", async () => {
      const { detail, location } = await loaded();
      const data = detail.current.data;
      if (!data) throw new Error("missing");
      detail.current = {
        status: "ok",
        data: {
          ...data,
          tooOld: true,
          data: {
            ...data.data,
            temperatureF: null,
            feelsLikeF: null,
            dewpointF: null,
            humidity: null,
            windMph: null,
            windDirection: null,
            windGustMph: null,
            pressureInHg: null,
            visibilityMi: null,
          },
        },
      };
      const el = mount({ detail }, location);
      const section = el.querySelector("[aria-labelledby=current-h]");
      expect(text(section?.querySelector(".wx-temp"))).toBe("—");
      const values = [...(section?.querySelectorAll("dd") ?? [])].map((d) =>
        text(d),
      );
      expect(values).toEqual(["—", "—", "—", "—", "—", "KMYZ"]);
      expect(section?.textContent).toContain("Reading is old");
    });

    it("formats wind", () => {
      const base = {
        windMph: 12,
        windDirection: "NW",
        windGustMph: 20,
      } as Parameters<typeof windText>[0];
      expect(windText(base)).toBe("NW 12 mph, gusts 20");
      expect(windText({ ...base, windGustMph: null })).toBe("NW 12 mph");
      expect(windText({ ...base, windDirection: null })).toBe(
        "12 mph, gusts 20",
      );
      expect(windText({ ...base, windMph: 0, windDirection: null })).toBe(
        "Calm",
      );
      expect(windText({ ...base, windMph: null })).toBe("—");
    });
  });

  describe("forecast", () => {
    it("lists 14 periods with high/low labels and details", async () => {
      const { detail, location } = await loaded();
      const el = mount({ detail }, location);
      const items = [...el.querySelectorAll(".detail-periods > li")];
      expect(items).toHaveLength(14);
      expect(text(items[0]?.querySelector(".wx-period-name"))).toBe(
        "Overnight",
      );
      expect(text(items[0]?.querySelector(".wx-period-temp"))).toMatch(
        /^Low \d+°$/,
      );
      const day = detail.forecast.data?.periods.findIndex((p) => p.isDaytime);
      expect(text(items[day ?? 0]?.querySelector(".wx-period-temp"))).toMatch(
        /^High \d+°$/,
      );
      expect(items[0]?.querySelector("details summary")?.textContent).toBe(
        "Details",
      );
      expect(el.querySelector("img[src*='icons']")).toBeNull();
    });

    it("shows precipitation only from 10 percent", () => {
      const detail = loadingDetail();
      const period = (n: number, precipChance: number | null) => ({
        number: n,
        name: `P${n}`,
        startTime: `2026-11-13T0${n}:00:00Z`,
        endTime: `2026-11-13T0${n + 1}:00:00Z`,
        isDaytime: true,
        temperature: 50,
        temperatureTrend: null,
        precipChance,
        windSpeed: "",
        windDirection: "",
        icon: null,
        shortForecast: "Clear",
        detailedForecast: "",
      });
      detail.forecast = {
        status: "ok",
        data: {
          updated: null,
          generatedAt: null,
          periods: [period(1, 9), period(2, 10), period(3, null)],
        },
      };
      const el = mount(
        { detail },
        {
          id: "l",
          name: "L",
          lat: 1,
          lon: 2,
          createdAt: "x",
        },
      );
      const items = [...el.querySelectorAll(".detail-periods > li")];
      expect(items.map((i) => i.textContent?.includes("Precip"))).toEqual([
        false,
        true,
        false,
      ]);
      expect(items[0]?.querySelector("details")).toBeNull();
    });
  });

  describe("hourly", () => {
    it("renders 48 rows with local times and day separators", async () => {
      const { detail, location } = await loaded();
      const el = mount({ detail }, location);
      const rows = [
        ...el.querySelectorAll("table.hourly tbody tr:not(.day-row)"),
      ];
      expect(rows).toHaveLength(48);
      // The fixture is in Central time; the viewer's zone must not matter.
      const first = rows[0]?.querySelector("th");
      expect(text(first)).toMatch(/^\d{1,2}:00 (AM|PM)$/);
      const days = [...el.querySelectorAll("tr.day-row")].map((r) => text(r));
      expect(days).toEqual(["Friday", "Saturday", "Sunday"]);
      const cells = [...(rows[1]?.querySelectorAll("td") ?? [])];
      expect(cells).toHaveLength(4);
      expect(el.querySelector(".table-scroll")?.getAttribute("tabindex")).toBe(
        "0",
      );
    });
  });

  describe("radar", () => {
    it("shows the loop image with a link to the station page", async () => {
      const { detail, location } = await loaded();
      const el = mount({ detail }, location);
      const img = el.querySelector<HTMLImageElement>(".wx-radar img");
      expect(img?.getAttribute("src")).toBe(
        "https://radar.weather.gov/ridge/standard/KTWX_loop.gif",
      );
      expect(img?.alt).toBe("Radar loop for Linn");
      expect(img?.getAttribute("loading")).toBe("lazy");
      expect(img?.getAttribute("width")).toBe("600");
      const link = el.querySelector<HTMLAnchorElement>(
        "a[href$='/station/KTWX/standard']",
      );
      expect(link?.textContent).toBe("Open full radar");
      expect(link?.target).toBe("_blank");
      expect(link?.rel).toContain("noopener");
    });

    it("falls back to the national loop once", async () => {
      const { detail, location } = await loaded();
      const el = mount({ detail }, location);
      const img = el.querySelector<HTMLImageElement>(".wx-radar img");
      if (!img) throw new Error("no image");
      img.dispatchEvent(new Event("error"));
      expect(img.getAttribute("src")).toBe(CONUS_LOOP);
      expect(img.alt).toContain("National radar");
      img.dispatchEvent(new Event("error"));
      expect(img.getAttribute("src")).toBe(CONUS_LOOP);
    });

    it("explains when there is no station or the device is offline", async () => {
      const { detail, location } = await loaded();
      const { nws } = location;
      if (!nws) throw new Error("missing meta");
      const noRadar = mount(
        { detail },
        { ...location, nws: { ...nws, radarStation: null } },
      );
      expect(noRadar.querySelector(".wx-radar")).toBeNull();
      expect(text(noRadar.querySelector("#radar-h")?.parentElement)).toContain(
        "No radar station",
      );
      const offline = mount({ detail, online: false }, location);
      expect(offline.querySelector("img")).toBeNull();
      expect(text(offline.querySelector("#radar-h")?.parentElement)).toContain(
        "Radar isn't available offline",
      );
    });
  });

  describe("panel states", () => {
    it("shows loading, error and stale notes per panel", async () => {
      const { detail, location } = await loaded({
        ...linnRoutes(),
        [HOURLY_URL]: 503,
      });
      detail.forecast = { ...detail.forecast, status: "stale" };
      detail.alerts = { status: "loading" };
      const el = mount({ detail }, location);
      const note = (id: string) =>
        text(el.querySelector(`#${id}`)?.parentElement);
      expect(note("alerts-h")).toContain("Alerts: Loading…");
      expect(note("hourly-h")).toContain(
        "Hourly forecast: Weather Service unavailable",
      );
      expect(note("forecast-h")).toMatch(/Showing saved data from/);
      expect(el.querySelectorAll(".detail-periods > li")).toHaveLength(14);
      expect(note("current-h")).not.toContain("Showing saved data");
    });
  });
});
