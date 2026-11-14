import { describe, expect, it, vi } from "vitest";
import { createDashboardController } from "../../src/app/dashboardController";
import {
  ALERTS_URL,
  dashboardSetup,
  FORECAST_URL,
  fakeLastGood,
  linnMeta,
  POINT_URL,
} from "../helpers/dashboardSetup";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(options: Parameters<typeof dashboardSetup>[0] = {}) {
  const base = dashboardSetup(options);
  const onChange = vi.fn();
  const controller = createDashboardController(base.ctx, {
    onChange,
    isOnline: () => base.isOnline(),
  });
  return { ...base, controller, onChange };
}

describe("createDashboardController", () => {
  it("starts with loading cards in store order", () => {
    const { controller, location } = setup();
    const { items } = controller.viewProps();
    expect(items.map((i) => i.location.id)).toEqual([location.id]);
    expect(items[0]?.summary.forecast.status).toBe("loading");
    expect(controller.lastUpdated).toBeNull();
    expect(controller.isOlderThan(60_000)).toBe(true);
  });

  it("loads every location and reports refreshing while it runs", async () => {
    const { controller, onChange, store } = setup();
    store.add({ name: "Second", lat: 39.7456, lon: -97.0892, nws: linnMeta() });
    const done = controller.load();
    expect(controller.refreshing).toBe(true);
    await done;
    expect(controller.refreshing).toBe(false);
    expect(controller.lastUpdated).not.toBeNull();
    expect(controller.isOlderThan(60_000)).toBe(false);
    const { items } = controller.viewProps();
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.summary.forecast.status === "ok")).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it("passes the refresh flag to the client", async () => {
    const { controller, count } = setup();
    await controller.load();
    await controller.load();
    // Served from the client's cache the second time.
    expect(count(FORECAST_URL)).toBe(1);
    await controller.load({ refresh: true });
    expect(count(FORECAST_URL)).toBe(2);
  });

  it("ignores results for a location removed while loading", async () => {
    const { controller, store, location } = setup();
    const done = controller.load();
    store.remove(location.id);
    await done;
    expect(controller.viewProps().items).toEqual([]);
  });

  it("loads a newly added location without refetching unchanged ones", async () => {
    const { controller, store, count } = setup();
    await controller.load();
    expect(count(FORECAST_URL)).toBe(1);
    store.add({ name: "Other", lat: 40, lon: -97 });
    expect(controller.refreshing).toBe(true);
    await vi.waitFor(() => expect(controller.refreshing).toBe(false));
    expect(controller.viewProps().items).toHaveLength(2);
    expect(count(FORECAST_URL)).toBe(1);
    expect(count(ALERTS_URL)).toBe(1);
  });

  it("reloads a location when its metadata changes", async () => {
    const { controller, store, location, onChange } = setup();
    await controller.load();
    onChange.mockClear();
    store.updateMeta(location.id, {
      ...linnMeta(),
      resolvedAt: "2026-11-14T00:00:00.000Z",
    });
    expect(controller.refreshing).toBe(true);
    await vi.waitFor(() => expect(controller.refreshing).toBe(false));
    expect(controller.viewProps().items[0]?.summary.forecast.status).toBe("ok");
  });

  it("does not reload on a rename", async () => {
    const { controller, store, location, onChange } = setup();
    await controller.load();
    onChange.mockClear();
    store.rename(location.id, "Renamed");
    expect(controller.refreshing).toBe(false);
    expect(controller.viewProps().items[0]?.location.name).toBe("Renamed");
    expect(onChange).toHaveBeenCalled();
  });

  it("resolves missing metadata once without a reload loop", async () => {
    const { controller, count } = setup({ withMeta: false });
    await controller.load();
    await tick();
    expect(count(POINT_URL)).toBe(1);
    expect(controller.refreshing).toBe(false);
  });

  it("reloads unhealthy cards when connectivity returns", async () => {
    const shared = fakeLastGood();
    const first = dashboardSetup({ lastGood: shared.lastGood });
    await createDashboardController(first.ctx, { onChange: () => {} }).load();

    const { controller, setOnline, fetchFn } = setup({
      lastGood: shared.lastGood,
      online: false,
    });
    expect(controller.online).toBe(false);
    await controller.load();
    expect(controller.viewProps().items[0]?.summary.forecast.status).toBe(
      "stale",
    );
    expect(fetchFn.calls).toHaveLength(0);

    setOnline(true);
    controller.setOnline(true);
    expect(controller.online).toBe(true);
    expect(controller.refreshing).toBe(true);
    await vi.waitFor(() => expect(controller.refreshing).toBe(false));
    expect(controller.viewProps().items[0]?.summary.forecast.status).toBe("ok");
  });

  it("does not reload healthy cards when connectivity returns", async () => {
    const { controller, fetchFn } = setup();
    await controller.load();
    const before = fetchFn.calls.length;
    controller.setOnline(false);
    controller.setOnline(true);
    expect(controller.refreshing).toBe(false);
    expect(fetchFn.calls).toHaveLength(before);
  });
});
