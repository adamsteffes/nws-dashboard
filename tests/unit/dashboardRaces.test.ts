import { describe, expect, it } from "vitest";
import { createDashboardController } from "../../src/app/dashboardController";
import { alertsUrl } from "../../src/nws/alerts";
import { pointUrl } from "../../src/nws/points";
import { loadLocationSummary } from "../../src/services/panels";
import { saveMetaIfUnchanged } from "../../src/services/resolveLocation";
import {
  ALERTS_URL,
  dashboardSetup,
  FORECAST_URL,
  KMYZ_URL,
  linnMeta,
  linnRoutes,
} from "../helpers/dashboardSetup";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const emptyAlerts = { type: "FeatureCollection", features: [] };

const answer =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

describe("a place replaced while its card loads", () => {
  it("loads the new coordinates and drops the old result", async () => {
    const g = gate();
    const base = dashboardSetup({
      routes: {
        ...linnRoutes(),
        [ALERTS_URL]: async () => {
          await g.opened;
          return new Response(JSON.stringify(emptyAlerts));
        },
        [alertsUrl(40, -100)]: answer(emptyAlerts),
        [pointUrl(40, -100)]: "points_linn-ks",
      },
    });
    const controller = createDashboardController(base.ctx, {
      onChange: () => {},
    });
    const done = controller.load();
    await tick();
    const original = base.store.get(base.location.id);
    if (!original) throw new Error("missing");
    base.store.replaceAll([
      { ...original, lat: 40, lon: -100, nws: undefined },
    ]);
    g.release();
    await done;
    await tick();
    await tick();
    expect(base.count(alertsUrl(40, -100))).toBe(1);
    expect(controller.viewProps().items[0]?.summary.alerts.status).toBe("ok");
    expect(base.store.get(original.id)?.lat).toBe(40);
  });

  it("does not store metadata resolved for the old place", async () => {
    const g = gate();
    let first = true;
    const base = dashboardSetup({
      routes: {
        ...linnRoutes(),
        [FORECAST_URL]: async () => {
          if (first) {
            first = false;
            await g.opened;
          }
          return new Response(JSON.stringify({ title: "nf", status: 404 }), {
            status: 404,
          });
        },
      },
    });
    const original = base.location;
    const pending = loadLocationSummary(base.ctx, original);
    await tick();
    base.store.replaceAll([
      { ...original, lat: 40, lon: -100, nws: undefined },
    ]);
    g.release();
    await pending;
    const after = base.store.get(original.id);
    expect(after?.lat).toBe(40);
    expect(after?.nws).toBeUndefined();
  });
});

describe("saveMetaIfUnchanged", () => {
  it("saves for the same place", () => {
    const { store, location } = dashboardSetup({ withMeta: false });
    expect(saveMetaIfUnchanged(store, location, linnMeta())).toBe(true);
    expect(store.get(location.id)?.nws?.forecastUrl).toBe(FORECAST_URL);
  });

  it("refuses when the location was replaced or removed", () => {
    const { store, location } = dashboardSetup({ withMeta: false });
    store.replaceAll([{ ...location, lat: 41 }]);
    expect(saveMetaIfUnchanged(store, location, linnMeta())).toBe(false);
    expect(store.get(location.id)?.nws).toBeUndefined();
    store.remove(location.id);
    expect(saveMetaIfUnchanged(store, location, linnMeta())).toBe(false);
  });
});

describe("controller details", () => {
  it("does not duplicate a load for a card still loading when connectivity returns", async () => {
    const g = gate();
    const base = dashboardSetup({
      routes: {
        ...linnRoutes(),
        [KMYZ_URL]: async () => {
          await g.opened;
          return new Response(JSON.stringify({}), { status: 500 });
        },
      },
    });
    const controller = createDashboardController(base.ctx, {
      onChange: () => {},
      isOnline: () => false,
    });
    const first = controller.load();
    await tick();
    const before = base.count(ALERTS_URL);
    controller.setOnline(true);
    await tick();
    expect(base.count(ALERTS_URL)).toBe(before);
    g.release();
    await first;
  });

  it("sets lastUpdated only when something loaded", async () => {
    const offline = dashboardSetup({ online: false, routes: {} });
    const failing = createDashboardController(offline.ctx, {
      onChange: () => {},
      isOnline: () => false,
    });
    await failing.load();
    expect(failing.lastUpdated).toBeNull();

    const online = dashboardSetup();
    const working = createDashboardController(online.ctx, {
      onChange: () => {},
    });
    await working.load();
    expect(working.lastUpdated).not.toBeNull();
  });

  it("does not set lastUpdated for store-triggered loads", async () => {
    const base = dashboardSetup();
    const controller = createDashboardController(base.ctx, {
      onChange: () => {},
    });
    base.store.add({ name: "Other", lat: 39.7456, lon: -97.0892 });
    await tick();
    await tick();
    expect(controller.lastUpdated).toBeNull();
  });
});

describe("loadLocationSummary without stations", () => {
  it("says there are no nearby stations", async () => {
    const base = dashboardSetup();
    base.store.updateMeta(base.location.id, { ...linnMeta(), stationIds: [] });
    const location = base.store.get(base.location.id);
    if (!location) throw new Error("missing");
    const summary = await loadLocationSummary(base.ctx, location);
    expect(summary.current).toEqual({
      status: "error",
      error: "No nearby weather stations",
    });
    expect(summary.forecast.status).toBe("ok");
  });
});
