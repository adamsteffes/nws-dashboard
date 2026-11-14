import { describe, expect, it } from "vitest";
import { loadLocationSummary } from "../../src/services/panels";
import {
  ALERTS_URL,
  dashboardSetup,
  FORECAST_URL,
  fakeLastGood,
  KMYZ_URL,
  linnRoutes,
  NOW,
  POINT_URL,
  STATIONS_URL,
} from "../helpers/dashboardSetup";

describe("loadLocationSummary", () => {
  it("loads all three panels", async () => {
    const { ctx, location } = dashboardSetup();
    const summary = await loadLocationSummary(ctx, location);
    expect(summary.alerts.status).toBe("ok");
    expect(summary.alerts.data).toEqual([]);
    expect(summary.current.status).toBe("ok");
    expect(summary.current.data?.data.stationId).toBe("KMYZ");
    expect(summary.current.data?.data.temperatureF).toBe(27);
    expect(summary.forecast.status).toBe("ok");
    expect(summary.forecast.data).toHaveLength(2);
    expect(summary.forecast.data?.[0]?.name).toBe("Overnight");
    expect(summary.forecast.fetchedAt).toBeTruthy();
  });

  it("reports alerts from the multi-alert fixture", async () => {
    const { ctx, location } = dashboardSetup({
      routes: { ...linnRoutes(), [ALERTS_URL]: "alerts_active_multi" },
    });
    const summary = await loadLocationSummary(ctx, location);
    expect(summary.alerts.data).toHaveLength(3);
  });

  it("fails one panel without touching the others", async () => {
    const { ctx, location } = dashboardSetup({
      routes: { ...linnRoutes(), [FORECAST_URL]: [503, 503, 503] },
    });
    const summary = await loadLocationSummary(ctx, location);
    expect(summary.forecast).toEqual({
      status: "error",
      error: "Weather Service unavailable",
    });
    expect(summary.alerts.status).toBe("ok");
    expect(summary.current.status).toBe("ok");
  });

  it("maps a malformed body to an unexpected-response error", async () => {
    const { ctx, location } = dashboardSetup({
      routes: {
        ...linnRoutes(),
        [ALERTS_URL]: { status: 200, body: { nope: true } },
      },
    });
    const summary = await loadLocationSummary(ctx, location);
    expect(summary.alerts).toMatchObject({
      status: "error",
      error: "Unexpected response",
    });
  });

  it("serves last-good data as stale when the service fails", async () => {
    const shared = fakeLastGood();
    const first = dashboardSetup({ lastGood: shared.lastGood });
    await loadLocationSummary(first.ctx, first.location);
    const second = dashboardSetup({
      lastGood: shared.lastGood,
      routes: { ...linnRoutes(), [FORECAST_URL]: [503, 503, 503] },
    });
    const summary = await loadLocationSummary(second.ctx, second.location, {
      refresh: true,
    });
    expect(summary.forecast.status).toBe("stale");
    expect(summary.forecast.data).toHaveLength(2);
    expect(summary.forecast.fetchedAt).toBe(NOW.toISOString());
    expect(summary.alerts.status).toBe("ok");
  });

  it("shows saved data as stale when offline", async () => {
    const shared = fakeLastGood();
    const online = dashboardSetup({ lastGood: shared.lastGood });
    await loadLocationSummary(online.ctx, online.location);

    const offline = dashboardSetup({
      lastGood: shared.lastGood,
      online: false,
      routes: {},
    });
    const summary = await loadLocationSummary(offline.ctx, offline.location);
    expect(summary.alerts.status).toBe("stale");
    expect(summary.current.status).toBe("stale");
    expect(summary.forecast.status).toBe("stale");
    expect(offline.fetchFn.calls).toHaveLength(0);
  });

  it("errors with an offline message when nothing is saved", async () => {
    const { ctx, location } = dashboardSetup({ online: false, routes: {} });
    const summary = await loadLocationSummary(ctx, location);
    for (const panel of [summary.alerts, summary.current, summary.forecast]) {
      expect(panel).toEqual({
        status: "error",
        error: "Offline — no saved data yet",
      });
    }
  });

  it("resolves and stores missing metadata first", async () => {
    const { ctx, location, store, count } = dashboardSetup({
      withMeta: false,
    });
    const summary = await loadLocationSummary(ctx, location);
    expect(summary.forecast.status).toBe("ok");
    expect(summary.current.status).toBe("ok");
    expect(count(POINT_URL)).toBe(1);
    expect(count(STATIONS_URL)).toBe(1);
    expect(store.get(location.id)?.nws?.stationIds[0]).toBe("KMYZ");
    expect(store.get(location.id)?.nws?.forecastUrl).toBe(FORECAST_URL);
  });

  it("errors every panel when metadata can't be resolved", async () => {
    const { ctx, location, store } = dashboardSetup({
      withMeta: false,
      routes: { ...linnRoutes(), [POINT_URL]: [503, 503, 503] },
    });
    const summary = await loadLocationSummary(ctx, location);
    // Alerts only need the coordinates, so they still load.
    expect(summary.alerts.status).toBe("ok");
    for (const panel of [summary.current, summary.forecast]) {
      expect(panel).toEqual({
        status: "error",
        error: "Weather Service unavailable",
      });
    }
    expect(store.get(location.id)?.nws).toBeUndefined();
  });

  it("re-resolves the point once when the forecast is 404, then retries", async () => {
    const { ctx, location, count } = dashboardSetup({
      routes: {
        ...linnRoutes(),
        [FORECAST_URL]: [{ fixture: "points_404" }, "forecast_linn-ks"],
      },
    });
    const summary = await loadLocationSummary(ctx, location);
    expect(summary.forecast.status).toBe("ok");
    expect(count(FORECAST_URL)).toBe(2);
    expect(count(POINT_URL)).toBe(1);
  });

  it("does not loop when the retried forecast is still 404", async () => {
    const { ctx, location, count } = dashboardSetup({
      routes: {
        ...linnRoutes(),
        [FORECAST_URL]: [{ fixture: "points_404" }, { fixture: "points_404" }],
      },
    });
    const summary = await loadLocationSummary(ctx, location);
    expect(summary.forecast.status).toBe("error");
    expect(summary.current.status).toBe("ok");
    expect(count(FORECAST_URL)).toBe(2);
    expect(count(POINT_URL)).toBe(1);
  });

  it("uses both stations when the first reading is unusable", async () => {
    const { ctx, location } = dashboardSetup({
      routes: { ...linnRoutes(), [KMYZ_URL]: [503, 503, 503] },
    });
    const summary = await loadLocationSummary(ctx, location);
    expect(summary.current.data?.data.stationId).toBe("KCNK");
    expect(summary.current.data?.usedFallback).toBe(true);
  });
});
