import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePoint } from "../../src/nws/points";
import {
  createLocationStore,
  metaFromPoint,
  type NwsMeta,
  slugify,
} from "../../src/store/locations";
import { createMemoryStorage } from "../helpers/memoryStorage";

const KEY = "nwsdash:locations:v1";
const T = Date.parse("2026-11-14T12:00:00Z");

afterEach(() => {
  vi.restoreAllMocks();
});

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "fixtures", "nws", `${name}.json`),
      "utf-8",
    ),
  );

const sampleMeta = (): NwsMeta =>
  metaFromPoint(
    parsePoint(fixture("points_linn-ks")),
    ["KCNK", "KMYZ"],
    new Date(T),
  );

const home = { name: "Home", lat: 39.7456, lon: -97.0892 };

describe("slugify", () => {
  it("lowercases and hyphenates ASCII", () => {
    expect(slugify("  My Cabin -- #2 ")).toBe("my-cabin-2");
  });

  it("strips accents instead of leaving a hole", () => {
    expect(slugify("Zürich")).toBe("zurich");
  });

  it("falls back for names with no ASCII letters or digits", () => {
    expect(slugify("🌧️🌧️")).toBe("location");
    expect(slugify("")).toBe("location");
  });

  it("caps length at 40 without a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(39)} bbbbb`);
    expect(slug).toBe("a".repeat(39));
    expect(slugify("x".repeat(100))).toHaveLength(40);
  });
});

describe("metaFromPoint", () => {
  it("copies the point fields and stamps resolvedAt", () => {
    const meta = sampleMeta();
    const point = parsePoint(fixture("points_linn-ks"));
    expect(meta).toEqual({
      ...point,
      resolvedAt: "2026-11-14T12:00:00.000Z",
      stationIds: ["KCNK", "KMYZ"],
    });
  });

  it("omits county when the point has none", () => {
    const point = parsePoint(fixture("points_linn-ks"));
    delete point.county;
    expect("county" in metaFromPoint(point, [], new Date(T))).toBe(false);
  });
});

describe("createLocationStore", () => {
  it("round-trips add/get/list/rename/updateMeta/remove", () => {
    const store = createLocationStore({
      storage: createMemoryStorage(),
      clock: () => T,
    });
    const added = store.add({ ...home, name: "  Home  " });
    expect(added).toEqual({
      id: "home",
      name: "Home",
      lat: 39.7456,
      lon: -97.0892,
      createdAt: "2026-11-14T12:00:00.000Z",
    });
    expect(store.get("home")).toEqual(added);
    expect(store.list()).toEqual([added]);

    const renamed = store.rename("home", "Cabin");
    expect(renamed.id).toBe("home");
    expect(store.get("home")?.name).toBe("Cabin");

    const meta = sampleMeta();
    store.updateMeta("home", meta);
    expect(store.get("home")?.nws).toEqual(meta);

    expect(store.remove("home")).toBe(true);
    expect(store.remove("home")).toBe(false);
    expect(store.list()).toEqual([]);
    expect(store.get("home")).toBeUndefined();
  });

  it("throws for unknown ids on rename and updateMeta", () => {
    const store = createLocationStore({ storage: createMemoryStorage() });
    expect(() => store.rename("nope", "X")).toThrow(RangeError);
    expect(() => store.updateMeta("nope", sampleMeta())).toThrow(RangeError);
  });

  it("persists across store instances", () => {
    const storage = createMemoryStorage();
    const a = createLocationStore({ storage, clock: () => T });
    a.add({ ...home, nws: sampleMeta() });
    const b = createLocationStore({ storage });
    expect(b.list()).toEqual(a.list());
    expect(b.corrupt).toBe(false);
    expect(b.dropped).toBe(0);
  });

  it("honours a custom key", () => {
    const storage = createMemoryStorage();
    createLocationStore({ storage, key: "custom" }).add(home);
    expect(storage.data.has("custom")).toBe(true);
    expect(storage.data.has(KEY)).toBe(false);
  });

  it("gives colliding names unique ids and keeps ids on rename", () => {
    const store = createLocationStore({ storage: createMemoryStorage() });
    expect(store.add(home).id).toBe("home");
    expect(store.add(home).id).toBe("home-2");
    expect(store.add({ ...home, name: "HOME!" }).id).toBe("home-3");
    store.rename("home-2", "Lake");
    expect(store.get("home-2")?.name).toBe("Lake");
    expect(store.add({ ...home, name: "Zürich" }).id).toBe("zurich");
    expect(store.add({ ...home, name: "🌧️" }).id).toBe("location");
  });

  it("rounds coordinates to 4 decimals", () => {
    const store = createLocationStore({ storage: createMemoryStorage() });
    const loc = store.add({ name: "A", lat: 39.745649, lon: -97.089249 });
    expect(loc.lat).toBe(39.7456);
    expect(loc.lon).toBe(-97.0892);
  });

  it("rejects invalid input with readable RangeErrors", () => {
    const store = createLocationStore({ storage: createMemoryStorage() });
    store.add(home);
    expect(() => store.add({ ...home, name: "   " })).toThrow(
      /Name must be 1 to 60/,
    );
    expect(() => store.add({ ...home, name: "x".repeat(61) })).toThrow(
      RangeError,
    );
    expect(() => store.add({ ...home, lat: 90.5 })).toThrow(/Latitude/);
    expect(() => store.add({ ...home, lat: Number.NaN })).toThrow(/Latitude/);
    expect(() => store.add({ ...home, lon: -180.5 })).toThrow(/Longitude/);
    expect(() => store.add({ ...home, lon: Infinity })).toThrow(RangeError);
    expect(() => store.rename("home", "")).toThrow(RangeError);
    expect(store.list()).toHaveLength(1);
  });

  it("accepts boundary coordinates", () => {
    const store = createLocationStore({ storage: createMemoryStorage() });
    expect(() => store.add({ name: "Pole", lat: 90, lon: 180 })).not.toThrow();
    expect(() => store.add({ name: "S", lat: -90, lon: -180 })).not.toThrow();
  });

  it("replaceAll swaps the list and rejects invalid entries untouched", () => {
    const store = createLocationStore({ storage: createMemoryStorage() });
    store.add(home);
    const other = createLocationStore({ storage: createMemoryStorage() });
    const loc = other.add({ name: "Other", lat: 1, lon: 2 });
    store.replaceAll([loc]);
    expect(store.list()).toEqual([loc]);
    expect(() => store.replaceAll([{ ...loc, name: "" }])).toThrow(RangeError);
    expect(store.list()).toEqual([loc]);
  });

  describe("storage problems", () => {
    it("works in memory when storage is undefined", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = createLocationStore({ storage: undefined });
      store.add(home);
      store.add({ ...home, name: "Two" });
      expect(store.list()).toHaveLength(2);
      expect(store.persistent).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("works in memory when setItem throws, warning once", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = createLocationStore({
        storage: createMemoryStorage({ failWrites: true }),
      });
      expect(store.persistent).toBe(true);
      store.add(home);
      store.add({ ...home, name: "Two" });
      expect(store.list()).toHaveLength(2);
      expect(store.persistent).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("is persistent with healthy storage and silent", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = createLocationStore({ storage: createMemoryStorage() });
      store.add(home);
      expect(store.persistent).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("stored data problems", () => {
    it("keeps unparseable JSON under a .corrupt key and starts empty", () => {
      const storage = createMemoryStorage();
      storage.data.set(KEY, "{not json");
      const store = createLocationStore({ storage, clock: () => T });
      expect(store.corrupt).toBe(true);
      expect(store.list()).toEqual([]);
      expect(storage.data.get(`${KEY}.corrupt-${T}`)).toBe("{not json");
      // The original is untouched until the user actually changes something.
      expect(storage.data.get(KEY)).toBe("{not json");
    });

    it("treats structurally invalid files as corrupt", () => {
      const storage = createMemoryStorage();
      const raw = JSON.stringify({ version: 1, locations: "nope" });
      storage.data.set(KEY, raw);
      const store = createLocationStore({ storage, clock: () => T });
      expect(store.corrupt).toBe(true);
      expect(storage.data.get(`${KEY}.corrupt-${T}`)).toBe(raw);
    });

    it("keeps valid entries from a partially invalid file", () => {
      const storage = createMemoryStorage();
      storage.data.set(
        KEY,
        JSON.stringify({
          version: 1,
          locations: [
            { id: "home", name: "Home", lat: 39.7, lon: -97.1 },
            { id: "bad", name: "Bad", lat: 999, lon: 0 },
            "junk",
          ],
        }),
      );
      const store = createLocationStore({ storage, clock: () => T });
      expect(store.corrupt).toBe(false);
      expect(store.dropped).toBe(2);
      expect(store.list().map((l) => l.id)).toEqual(["home"]);
    });
  });

  describe("subscribe", () => {
    it("notifies after every change until unsubscribed", () => {
      const store = createLocationStore({ storage: createMemoryStorage() });
      const fn = vi.fn();
      const off = store.subscribe(fn);
      store.add(home);
      store.rename("home", "Cabin");
      store.updateMeta("home", sampleMeta());
      store.remove("home");
      expect(fn).toHaveBeenCalledTimes(4);
      off();
      store.add(home);
      expect(fn).toHaveBeenCalledTimes(4);
    });

    it("does not notify for a remove that changes nothing", () => {
      const store = createLocationStore({ storage: createMemoryStorage() });
      const fn = vi.fn();
      store.subscribe(fn);
      store.remove("nope");
      expect(fn).not.toHaveBeenCalled();
    });

    it("reloads and notifies on a storage event for its key", () => {
      const storage = createMemoryStorage();
      const a = createLocationStore({ storage });
      const b = createLocationStore({ storage });
      const fn = vi.fn();
      b.subscribe(fn);
      a.add(home);
      expect(b.list()).toEqual([]);
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
      expect(b.list()).toEqual(a.list());
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("ignores storage events for other keys", () => {
      const storage = createMemoryStorage();
      const store = createLocationStore({ storage });
      const fn = vi.fn();
      store.subscribe(fn);
      window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
