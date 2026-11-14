import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDiscussionController } from "../../src/app/discussionController";
import { afdListUrl, productUrl } from "../../src/nws/afd";
import {
  dashboardSetup,
  fakeLastGood,
  linnRoutes,
} from "../helpers/dashboardSetup";

const readFixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "fixtures", "nws", `${name}.json`),
      "utf-8",
    ),
  );

const LIST_URL = afdListUrl("TOP");
const list = readFixture("afd_list_linn-ks") as {
  "@graph": { id: string }[];
};
const NEWEST = list["@graph"][0]?.id as string;
const OLDER = list["@graph"][1]?.id as string;
const MIAMI_ID = (
  readFixture("afd_list_miami-fl") as { "@graph": { id: string }[] }
)["@graph"][0]?.id as string;
const THIRD = list["@graph"][2]?.id as string;
const olderBody = {
  ...readFixture("afd_product_linn-ks"),
  id: OLDER,
  productText: "OLDER DISCUSSION TEXT",
};

const routes = (extra = {}) => ({
  ...linnRoutes(),
  [LIST_URL]: "afd_list_linn-ks",
  [productUrl(NEWEST)]: "afd_product_linn-ks",
  [productUrl(OLDER)]: { status: 200, body: olderBody },
  ...extra,
});

function setup(options: Parameters<typeof dashboardSetup>[0] = {}, extra = {}) {
  const base = dashboardSetup({ routes: routes(extra), ...options });
  const onChange = vi.fn();
  const controller = createDiscussionController(base.ctx, { onChange });
  return { ...base, controller, onChange };
}

describe("createDiscussionController", () => {
  it("loads the list and the latest discussion", async () => {
    const { controller, location } = setup();
    const done = controller.open(location.id);
    expect(controller.refreshing).toBe(true);
    expect(controller.viewProps().product.status).toBe("loading");
    await done;
    expect(controller.refreshing).toBe(false);
    const props = controller.viewProps();
    expect(props.location?.id).toBe(location.id);
    expect(props.productId).toBeUndefined();
    expect(props.list.status).toBe("ok");
    expect(props.list.data?.[0]?.id).toBe(NEWEST);
    expect(props.product.status).toBe("ok");
    expect(props.product.data?.id).toBe(NEWEST);
  });

  it("loads the list and the requested product when given a productId", async () => {
    const { controller, location, count } = setup();
    await controller.open(location.id, OLDER);
    const props = controller.viewProps();
    expect(props.productId).toBe(OLDER);
    expect(props.product.data?.text).toBe("OLDER DISCUSSION TEXT");
    expect(props.list.data?.length).toBeGreaterThan(1);
    expect(count(productUrl(NEWEST))).toBe(0);
  });

  it("keeps the product when only the list fails", async () => {
    const { controller, location } = setup({}, { [LIST_URL]: 503 });
    await controller.open(location.id, OLDER);
    const props = controller.viewProps();
    expect(props.list.status).toBe("error");
    expect(props.list.error).toBe("Weather Service unavailable");
    expect(props.product.status).toBe("ok");
  });

  it("shows an error for a product that cannot be loaded", async () => {
    const { controller, location } = setup({}, { [productUrl(OLDER)]: 503 });
    await controller.open(location.id, OLDER);
    const props = controller.viewProps();
    expect(props.product.status).toBe("error");
    expect(props.list.status).toBe("ok");
  });

  it("falls back to an older discussion when the newest fails", async () => {
    const { controller, location } = setup({}, { [productUrl(NEWEST)]: 503 });
    await controller.open(location.id);
    const props = controller.viewProps();
    expect(props.product.status).toBe("ok");
    expect(props.product.data?.id).toBe(OLDER);
    expect(props.list.data?.[0]?.id).toBe(NEWEST);
  });

  it("reports an error when no discussion could be fetched", async () => {
    const { controller, location } = setup(
      {},
      {
        [productUrl(NEWEST)]: 503,
        [productUrl(OLDER)]: 503,
        [productUrl(THIRD)]: 503,
      },
    );
    await controller.open(location.id);
    const props = controller.viewProps();
    expect(props.product.status).toBe("error");
    expect(props.list.status).toBe("ok");
  });

  it("reports no discussion for an empty list", async () => {
    const { controller, location } = setup(
      {},
      { [LIST_URL]: { status: 200, body: { "@graph": [] } } },
    );
    await controller.open(location.id);
    const props = controller.viewProps();
    expect(props.list.data).toEqual([]);
    expect(props.product.status).toBe("ok");
    expect(props.product.data).toBeUndefined();
  });

  it("fails both panels when the list fetch fails", async () => {
    const { controller, location } = setup({}, { [LIST_URL]: 503 });
    await controller.open(location.id);
    const props = controller.viewProps();
    expect(props.list.status).toBe("error");
    expect(props.product.status).toBe("error");
  });

  it("shows saved data, marked stale, when offline", async () => {
    const { lastGood } = fakeLastGood();
    const { controller, location, setOnline } = setup({ lastGood });
    await controller.open(location.id);
    setOnline(false);
    await controller.refresh();
    const props = controller.viewProps();
    expect(props.list.status).toBe("stale");
    expect(props.product.status).toBe("stale");
    expect(props.product.data?.id).toBe(NEWEST);
    expect(props.product.fetchedAt).toBeDefined();
  });

  it("refresh bypasses the cache", async () => {
    const { controller, location, count } = setup();
    await controller.open(location.id);
    await controller.open(location.id);
    expect(count(LIST_URL)).toBe(1);
    await controller.refresh();
    expect(count(LIST_URL)).toBe(2);
  });

  it("resolves a location without metadata, saves it and then loads", async () => {
    const { controller, store, location } = setup({ withMeta: false });
    expect(location.nws).toBeUndefined();
    await controller.open(location.id);
    expect(store.get(location.id)?.nws?.cwa).toBe("TOP");
    expect(controller.viewProps().product.data?.id).toBe(NEWEST);
  });

  it("shows the lookup error when metadata cannot be resolved", async () => {
    const { controller, location } = setup(
      { withMeta: false },
      { "https://api.weather.gov/points/39.7456,-97.0892": 503 },
    );
    await controller.open(location.id);
    const props = controller.viewProps();
    expect(props.list.status).toBe("error");
    expect(props.product.error).toBe("Weather Service unavailable");
  });

  it("drops results of an earlier open when another one starts", async () => {
    const { controller, location } = setup();
    const first = controller.open(location.id);
    const second = controller.open(location.id, OLDER);
    await Promise.all([first, second]);
    const props = controller.viewProps();
    expect(props.productId).toBe(OLDER);
    expect(props.product.data?.id).toBe(OLDER);
  });

  it("drops results when opened for another location", async () => {
    const { controller, location, store } = setup();
    const other = store.add({ name: "Other", lat: 39.7456, lon: -97.0892 });
    const first = controller.open(location.id, OLDER);
    const second = controller.open(other.id);
    await Promise.all([first, second]);
    const props = controller.viewProps();
    expect(props.location?.id).toBe(other.id);
    expect(props.product.data?.id).toBe(NEWEST);
  });

  it("has no location for an unknown id and does not fetch", async () => {
    const { controller, fetchFn } = setup();
    await controller.open("nowhere");
    expect(controller.viewProps().location).toBeUndefined();
    expect(fetchFn.calls).toHaveLength(0);
  });

  it("drops results for a location replaced mid-load and loads the new place", async () => {
    const { controller, store, location, count } = setup(
      {},
      {
        [afdListUrl("MFL")]: "afd_list_miami-fl",
        [productUrl(MIAMI_ID)]: "afd_product_miami-fl",
      },
    );
    const first = controller.open(location.id);
    const old = store.get(location.id);
    if (!old?.nws) throw new Error("setup has meta");
    store.replaceAll([
      {
        ...old,
        name: "Miami",
        lat: 25.77,
        lon: -80.19,
        createdAt: "2026-11-14T00:00:00.000Z",
        nws: { ...old.nws, cwa: "MFL", timeZone: "America/New_York" },
      },
    ]);
    await first;
    await vi.waitFor(() => expect(controller.refreshing).toBe(false));
    const props = controller.viewProps();
    expect(props.location?.name).toBe("Miami");
    expect(props.product.data?.id).toBe(MIAMI_ID);
    expect(count(afdListUrl("MFL"))).toBe(1);
  });

  it("loads when a location that was missing appears", async () => {
    const { controller, store, location, fetchFn } = setup();
    await controller.open("later");
    expect(fetchFn.calls).toHaveLength(0);
    const loc = store.get(location.id);
    if (!loc) throw new Error("setup has a location");
    store.replaceAll([loc, { ...loc, id: "later" }]);
    await vi.waitFor(() =>
      expect(controller.viewProps().product.data?.id).toBe(NEWEST),
    );
  });

  it("does not reload for renames or for metadata it saved itself", async () => {
    const { controller, store, location, count } = setup({ withMeta: false });
    await controller.open(location.id);
    expect(store.get(location.id)?.nws?.cwa).toBe("TOP");
    expect(count(LIST_URL)).toBe(1);
    store.rename(location.id, "Renamed");
    await Promise.resolve();
    expect(count(LIST_URL)).toBe(1);
    expect(controller.viewProps().product.status).toBe("ok");
  });

  it("remembers the sections toggle and notifies", () => {
    const { controller, onChange } = setup();
    expect(controller.viewProps().sections).toBe(false);
    controller.setSections(true);
    expect(controller.viewProps().sections).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });
});
