import { describe, expect, it, vi } from "vitest";
import { createDashboardController } from "../../src/app/dashboardController";
import { createLocationController } from "../../src/app/locationController";
import { alertsUrl } from "../../src/nws/alerts";
import { pointUrl } from "../../src/nws/points";
import {
  ALERTS_URL,
  dashboardSetup,
  FORECAST_URL,
  fakeLastGood,
  HOURLY_URL,
  KCNK_URL,
  KMYZ_URL,
  linnMeta,
  linnRoutes,
  NOW,
  POINT_URL,
} from "../helpers/dashboardSetup";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(options: Parameters<typeof dashboardSetup>[0] = {}) {
  const base = dashboardSetup(options);
  const onChange = vi.fn();
  const controller = createLocationController(base.ctx, {
    onChange,
    isOnline: () => base.isOnline(),
  });
  return { ...base, controller, onChange };
}

function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

describe("createLocationController", () => {
  it("shows loading panels before anything is opened", () => {
    const { controller, location } = setup();
    const props = controller.viewProps(location.id);
    expect(props.location?.id).toBe(location.id);
    expect(props.detail.hourly.status).toBe("loading");
    expect(controller.refreshing).toBe(false);
  });

  it("opens a location and loads its panels", async () => {
    const { controller, location, onChange } = setup();
    const done = controller.open(location.id);
    expect(controller.refreshing).toBe(true);
    await done;
    expect(controller.refreshing).toBe(false);
    const { detail } = controller.viewProps(location.id);
    expect(detail.hourly.data).toHaveLength(48);
    expect(detail.forecast.status).toBe("ok");
    expect(onChange).toHaveBeenCalled();
  });

  it("makes no extra requests for the dashboard's data after a dashboard load", async () => {
    const base = dashboardSetup();
    await createDashboardController(base.ctx, { onChange: () => {} }).load();
    const before = base.fetchFn.calls.length;
    const controller = createLocationController(base.ctx, {
      onChange: () => {},
    });
    await controller.open(base.location.id);
    const urls = base.fetchFn.calls.slice(before).map((c) => c.url);
    // The hourly forecast is new; what the dashboard loaded comes from the cache.
    // (The recorded third station has no reading, and failures are not cached.)
    expect(urls).toContain(HOURLY_URL);
    for (const url of [ALERTS_URL, FORECAST_URL, KMYZ_URL, KCNK_URL]) {
      expect(urls).not.toContain(url);
    }
  });

  it("refresh bypasses the cache", async () => {
    const { controller, location, count } = setup();
    await controller.open(location.id);
    await controller.open(location.id);
    expect(count(FORECAST_URL)).toBe(1);
    await controller.refresh();
    expect(count(FORECAST_URL)).toBe(2);
    expect(count(HOURLY_URL)).toBe(2);
  });

  it("refresh with nothing open does nothing", async () => {
    const { controller, fetchFn } = setup();
    await controller.refresh();
    expect(fetchFn.calls).toHaveLength(0);
  });

  it("starts empty when another location is opened", async () => {
    const { controller, store, location } = setup();
    const other = store.add({
      name: "Other",
      lat: 39.7456,
      lon: -97.0892,
      nws: linnMeta(),
    });
    await controller.open(location.id);
    const done = controller.open(other.id);
    expect(controller.viewProps(other.id).detail.alerts.status).toBe("loading");
    expect(controller.viewProps(location.id).detail.alerts.status).toBe(
      "loading",
    );
    await done;
    expect(controller.viewProps(other.id).detail.alerts.status).toBe("ok");
  });

  it("reports an unknown id without loading", async () => {
    const { controller, fetchFn } = setup();
    await controller.open("nope");
    expect(controller.viewProps("nope").location).toBeUndefined();
    expect(fetchFn.calls).toHaveLength(0);
  });

  it("drops the result of an earlier open when another is opened", async () => {
    const g = gate();
    const { controller, store, location } = setup({
      routes: {
        ...linnRoutes(),
        [ALERTS_URL]: async () => {
          await g.opened;
          return new Response(
            JSON.stringify({ type: "FeatureCollection", features: [] }),
          );
        },
      },
    });
    const other = store.add({
      name: "Other",
      lat: 40,
      lon: -100,
      nws: linnMeta(),
    });
    const slow = controller.open(location.id);
    await tick();
    controller.open(other.id).catch(() => {});
    g.release();
    await slow;
    expect(controller.viewProps(location.id).detail.alerts.status).toBe(
      "loading",
    );
  });

  it("reloads when the place changes mid-load and drops the old result", async () => {
    const g = gate();
    const empty = { type: "FeatureCollection", features: [] };
    const base = dashboardSetup({
      routes: {
        ...linnRoutes(),
        [ALERTS_URL]: async () => {
          await g.opened;
          return new Response(JSON.stringify(empty));
        },
        [alertsUrl(40, -100)]: () =>
          Promise.resolve(new Response(JSON.stringify(empty))),
        [pointUrl(40, -100)]: "points_linn-ks",
      },
    });
    const controller = createLocationController(base.ctx, {
      onChange: () => {},
    });
    const done = controller.open(base.location.id);
    await tick();
    const original = base.store.get(base.location.id);
    if (!original) throw new Error("missing");
    base.store.replaceAll([
      { ...original, lat: 40, lon: -100, nws: undefined, createdAt: "later" },
    ]);
    g.release();
    await done;
    await vi.waitFor(() => expect(controller.refreshing).toBe(false));
    await tick();
    expect(base.fetchFn.calls.some((c) => c.url === alertsUrl(40, -100))).toBe(
      true,
    );
    expect(controller.viewProps(base.location.id).detail.alerts.status).toBe(
      "ok",
    );
  });

  it("does not reload on a rename", async () => {
    const { controller, store, location, count } = setup();
    await controller.open(location.id);
    store.rename(location.id, "Renamed");
    expect(controller.refreshing).toBe(false);
    expect(count(FORECAST_URL)).toBe(1);
    expect(controller.viewProps(location.id).location?.name).toBe("Renamed");
  });

  it("forgets its data when the location is deleted", async () => {
    const { controller, store, location } = setup();
    await controller.open(location.id);
    store.remove(location.id);
    expect(controller.viewProps(location.id).location).toBeUndefined();
    expect(controller.viewProps(location.id).detail.alerts.status).toBe(
      "loading",
    );
  });

  it("resolves missing metadata once without a reload loop", async () => {
    const { controller, location, count } = setup({ withMeta: false });
    await controller.open(location.id);
    await tick();
    expect(count("https://api.weather.gov/points/39.7456,-97.0892")).toBe(1);
    expect(controller.refreshing).toBe(false);
  });

  it("reloads unhealthy panels when connectivity returns", async () => {
    const shared = fakeLastGood();
    const first = dashboardSetup({ lastGood: shared.lastGood });
    await createLocationController(first.ctx, { onChange: () => {} }).open(
      first.location.id,
    );

    const { controller, location, setOnline } = setup({
      lastGood: shared.lastGood,
      online: false,
    });
    await controller.open(location.id);
    expect(controller.viewProps(location.id).detail.hourly.status).toBe(
      "stale",
    );
    setOnline(true);
    controller.setOnline(true);
    expect(controller.online).toBe(true);
    expect(controller.refreshing).toBe(true);
    await vi.waitFor(() => expect(controller.refreshing).toBe(false));
    expect(controller.viewProps(location.id).detail.hourly.status).toBe("ok");
  });

  it("does not reload healthy panels when connectivity returns", async () => {
    const { controller, location, fetchFn } = setup();
    await controller.open(location.id);
    const before = fetchFn.calls.length;
    controller.setOnline(false);
    controller.setOnline(true);
    expect(controller.refreshing).toBe(false);
    expect(fetchFn.calls).toHaveLength(before);
  });

  it("does not load in the background after the page is closed", async () => {
    const { controller, store, location, count } = setup();
    await controller.open(location.id);
    controller.close();
    store.updateMeta(location.id, {
      ...linnMeta(),
      resolvedAt: "2026-11-14T00:00:00.000Z",
    });
    expect(controller.refreshing).toBe(false);
    expect(count(FORECAST_URL)).toBe(1);
    // The data stays, so coming back shows it at once.
    expect(controller.viewProps(location.id).detail.forecast.status).toBe("ok");
  });

  it("ignores connectivity changes while closed, and reloads on reopen", async () => {
    const shared = fakeLastGood();
    const first = dashboardSetup({ lastGood: shared.lastGood });
    await createLocationController(first.ctx, { onChange: () => {} }).open(
      first.location.id,
    );
    const { controller, location, setOnline, count } = setup({
      lastGood: shared.lastGood,
      online: false,
    });
    await controller.open(location.id);
    controller.close();
    setOnline(true);
    controller.setOnline(true);
    expect(controller.refreshing).toBe(false);
    expect(count(FORECAST_URL)).toBe(0);
    await controller.open(location.id);
    expect(controller.viewProps(location.id).detail.forecast.status).toBe("ok");
  });

  it("does not load the hidden dashboard when it saves metadata", async () => {
    const base = dashboardSetup({ withMeta: false });
    const other = base.store.add({ name: "Other", lat: 40, lon: -100 });
    const dashboard = createDashboardController(base.ctx, {
      onChange: () => {},
    });
    const controller = createLocationController(base.ctx, {
      onChange: () => {},
    });
    await controller.open(base.location.id);
    await tick();
    expect(dashboard.refreshing).toBe(false);
    expect(
      base.fetchFn.calls.some((c) => c.url === alertsUrl(other.lat, other.lon)),
    ).toBe(false);
  });

  it("shares one metadata lookup between the dashboard and the detail page", async () => {
    const base = dashboardSetup({ withMeta: false });
    let t = NOW.getTime();
    const ctx = {
      ...base.ctx,
      now: () => {
        t += 1000;
        return new Date(t);
      },
    };
    const writes: string[] = [];
    base.store.subscribe(() => writes.push("write"));
    const dashboard = createDashboardController(ctx, { onChange: () => {} });
    const controller = createLocationController(ctx, { onChange: () => {} });
    await Promise.all([dashboard.load(), controller.open(base.location.id)]);
    await tick();
    expect(base.count(POINT_URL)).toBe(1);
    expect(writes).toHaveLength(1);
    expect(base.count(HOURLY_URL)).toBe(1);
    expect(controller.viewProps(base.location.id).detail.hourly.status).toBe(
      "ok",
    );
  });
});
