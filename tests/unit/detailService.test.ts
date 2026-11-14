import { describe, expect, it } from "vitest";
import { loadLocationDetail } from "../../src/services/detail";
import {
  ALERTS_URL,
  dashboardSetup,
  FORECAST_URL,
  fakeLastGood,
  HOURLY_URL,
  KMYZ_URL,
  linnRoutes,
  POINT_URL,
} from "../helpers/dashboardSetup";

describe("loadLocationDetail", () => {
  it("loads every panel from the recorded fixtures", async () => {
    const { ctx, location } = dashboardSetup();
    const detail = await loadLocationDetail(ctx, location);
    expect(detail.alerts.status).toBe("ok");
    expect(detail.current.status).toBe("ok");
    expect(detail.forecast.status).toBe("ok");
    expect(detail.forecast.data?.periods).toHaveLength(14);
    expect(detail.hourly.status).toBe("ok");
    expect(detail.hourly.data).toHaveLength(48);
    // The first hour is still running at the fixed clock.
    expect(detail.hourly.data?.[0]?.startTime).toBe(
      "2026-11-13T02:00:00-06:00",
    );
  });

  it("shows one failing panel as an error without hiding the others", async () => {
    const { ctx, location } = dashboardSetup({
      routes: { ...linnRoutes(), [HOURLY_URL]: 503 },
    });
    const detail = await loadLocationDetail(ctx, location);
    expect(detail.hourly).toEqual({
      status: "error",
      error: "Weather Service unavailable",
    });
    expect(detail.alerts.status).toBe("ok");
    expect(detail.current.status).toBe("ok");
    expect(detail.forecast.status).toBe("ok");
  });

  it("reports an error offline when nothing was saved", async () => {
    const { ctx, location } = dashboardSetup({ online: false });
    const detail = await loadLocationDetail(ctx, location);
    expect(detail.forecast).toEqual({
      status: "error",
      error: "Offline — no saved data yet",
    });
  });

  it("serves saved copies as stale when offline", async () => {
    const shared = fakeLastGood();
    const first = dashboardSetup({ lastGood: shared.lastGood });
    await loadLocationDetail(first.ctx, first.location);
    const { ctx, location, fetchFn } = dashboardSetup({
      lastGood: shared.lastGood,
      online: false,
    });
    const detail = await loadLocationDetail(ctx, location);
    expect(detail.alerts.status).toBe("stale");
    expect(detail.current.status).toBe("stale");
    expect(detail.forecast.status).toBe("stale");
    expect(detail.hourly.status).toBe("stale");
    expect(detail.hourly.data).toHaveLength(48);
    expect(fetchFn.calls).toHaveLength(0);
  });

  it("resolves missing metadata first and saves it", async () => {
    const { ctx, location, store, count } = dashboardSetup({
      withMeta: false,
    });
    const detail = await loadLocationDetail(ctx, location);
    expect(count(POINT_URL)).toBe(1);
    expect(detail.hourly.status).toBe("ok");
    expect(store.get(location.id)?.nws?.forecastHourlyUrl).toBe(HOURLY_URL);
  });

  it("marks every panel as an error when the lookup fails", async () => {
    const { ctx, location } = dashboardSetup({
      withMeta: false,
      routes: { ...linnRoutes(), [POINT_URL]: 503 },
    });
    const detail = await loadLocationDetail(ctx, location);
    for (const panel of Object.values(detail)) {
      expect(panel.status).toBe("error");
    }
  });

  it("re-resolves once when the forecast and hourly URLs are both 404", async () => {
    const { ctx, location, count } = dashboardSetup({
      routes: {
        ...linnRoutes(),
        [FORECAST_URL]: [{ fixture: "points_404" }, "forecast_linn-ks"],
        [HOURLY_URL]: [{ fixture: "points_404" }, "forecast_hourly_linn-ks"],
      },
    });
    const detail = await loadLocationDetail(ctx, location);
    expect(detail.forecast.status).toBe("ok");
    expect(detail.hourly.status).toBe("ok");
    expect(count(POINT_URL)).toBe(1);
    expect(count(FORECAST_URL)).toBe(2);
    expect(count(HOURLY_URL)).toBe(2);
  });

  it("does not loop when the retried hourly URL is still 404", async () => {
    const { ctx, location, count } = dashboardSetup({
      routes: {
        ...linnRoutes(),
        [HOURLY_URL]: [{ fixture: "points_404" }, { fixture: "points_404" }],
      },
    });
    const detail = await loadLocationDetail(ctx, location);
    expect(detail.hourly.status).toBe("error");
    expect(detail.forecast.status).toBe("ok");
    expect(count(HOURLY_URL)).toBe(2);
    expect(count(POINT_URL)).toBe(1);
  });

  it("does not save re-resolved metadata onto a replaced place", async () => {
    const { ctx, location, store } = dashboardSetup({
      routes: {
        ...linnRoutes(),
        [FORECAST_URL]: [{ fixture: "points_404" }, "forecast_linn-ks"],
      },
    });
    // The load still holds the old place, as when the list changes mid-load.
    store.replaceAll([{ ...location, lat: 1, lon: 2, nws: undefined }]);
    await loadLocationDetail(ctx, location);
    expect(store.get(location.id)?.nws).toBeUndefined();
  });

  it("asks for fresh data on refresh", async () => {
    const { ctx, location, count } = dashboardSetup();
    await loadLocationDetail(ctx, location);
    await loadLocationDetail(ctx, location);
    expect(count(HOURLY_URL)).toBe(1);
    await loadLocationDetail(ctx, location, { refresh: true });
    expect(count(HOURLY_URL)).toBe(2);
    expect(count(ALERTS_URL)).toBe(2);
    expect(count(KMYZ_URL)).toBe(2);
  });
});
