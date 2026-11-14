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

    it("refuses and rolls back when writes fail over existing data", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const storage = createMemoryStorage({ failWrites: true });
      const raw = JSON.stringify({
        version: 1,
        locations: [{ id: "a", name: "A", lat: 1, lon: 1 }],
      });
      storage.data.set(KEY, raw);
      const store = createLocationStore({ storage });
      expect(store.persistent).toBe(true);
      expect(() => store.add(home)).toThrow(/Couldn't save/);
      expect(() => store.add(home)).toThrow(/Couldn't save/);
      expect(store.list().map((l) => l.id)).toEqual(["a"]);
      expect(store.persistent).toBe(false);
      expect(storage.data.get(KEY)).toBe(raw);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("switches to memory when writes fail and nothing is stored", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = createLocationStore({
        storage: createMemoryStorage({ failWrites: true }),
      });
      expect(() => store.add(home)).not.toThrow();
      expect(() => store.add(home)).not.toThrow();
      expect(store.list().map((l) => l.id)).toEqual(["home", "home-2"]);
      expect(store.persistent).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("restores the previous list when a later save fails", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const storage = createMemoryStorage({ quotaBytes: 500 });
      const store = createLocationStore({ storage });
      const kept = store.add(home);
      expect(() => store.add({ ...home, nws: sampleMeta() })).toThrow(
        /Couldn't save/,
      );
      expect(store.list()).toEqual([kept]);
      expect(JSON.parse(storage.data.get(KEY) ?? "").locations).toHaveLength(1);
      expect(() => store.rename("home", "Z")).not.toThrow();
      expect(store.persistent).toBe(true);
    });

    it("keeps working in memory when getItem throws", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = createLocationStore({
        storage: createMemoryStorage({ failReads: true }),
      });
      expect(store.persistent).toBe(false);
      store.add(home);
      expect(store.list()).toHaveLength(1);
    });

    it("ignores storage events while holding unsaved in-memory changes", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = createLocationStore({
        storage: createMemoryStorage({ failReads: true }),
      });
      store.add(home);
      warn.mockClear();
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
      expect(store.list()).toHaveLength(1);
      // Stores from earlier tests also listen, so only assert it warned.
      expect(warn).toHaveBeenCalled();
    });

    it("falls back to memory when localStorage access throws", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
      try {
        const store = createLocationStore();
        store.add(home);
        expect(store.persistent).toBe(false);
        expect(store.list()).toHaveLength(1);
      } finally {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
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
      expect(storage.data.get(`${KEY}.corrupt`)).toBe("{not json");
      // The original is untouched until the user actually changes something.
      expect(storage.data.get(KEY)).toBe("{not json");
    });

    it("treats structurally invalid files as corrupt", () => {
      const storage = createMemoryStorage();
      const raw = JSON.stringify({ version: 1, locations: "nope" });
      storage.data.set(KEY, raw);
      const store = createLocationStore({ storage, clock: () => T });
      expect(store.corrupt).toBe(true);
      expect(storage.data.get(`${KEY}.corrupt`)).toBe(raw);
    });

    it("does not re-copy unreadable data on every load", () => {
      const storage = createMemoryStorage();
      storage.data.set(KEY, "{bad");
      for (let i = 0; i < 4; i++) createLocationStore({ storage });
      expect([...storage.data.keys()].sort()).toEqual([KEY, `${KEY}.corrupt`]);
    });

    it("uses numbered backup slots for different bad data, then pauses", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const storage = createMemoryStorage();
      for (const raw of ["{a", "{b", "{c"]) {
        storage.data.set(KEY, raw);
        createLocationStore({ storage });
      }
      expect(storage.data.get(`${KEY}.corrupt`)).toBe("{a");
      expect(storage.data.get(`${KEY}.corrupt-2`)).toBe("{b");
      expect(storage.data.get(`${KEY}.corrupt-3`)).toBe("{c");
      storage.data.set(KEY, "{d");
      const store = createLocationStore({ storage });
      expect(store.readOnly).toBe(true);
    });

    it("never overwrites unreadable data when the backup fails", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const raw = `{"version":1,"locations":[${"x".repeat(3000)}`;
      const storage = createMemoryStorage({ quotaBytes: 5000 });
      storage.data.set(KEY, raw);
      const store = createLocationStore({ storage });
      expect(store.corrupt).toBe(true);
      expect(store.readOnly).toBe(true);
      expect(store.readOnlyReason).toMatch(/backed up/);
      expect(() => store.add(home)).toThrow(/changes are paused/);
      expect(storage.data.get(KEY)).toBe(raw);
      store.discardCorrupt();
      expect(store.readOnly).toBe(false);
      store.add(home);
      expect(store.list()).toHaveLength(1);
    });

    it("treats a newer version as read-only and never writes", () => {
      const storage = createMemoryStorage();
      const raw = JSON.stringify({
        version: 2,
        locations: [{ id: "a", name: "A", lat: 1, lon: 1 }],
      });
      storage.data.set(KEY, raw);
      const store = createLocationStore({ storage });
      expect(store.corrupt).toBe(false);
      expect(store.readOnly).toBe(true);
      expect(store.readOnlyReason).toMatch(/newer version.*reload to update/);
      expect(store.list().map((l) => l.id)).toEqual(["a"]);
      expect(() => store.add(home)).toThrow(/newer version/);
      expect(() => store.remove("a")).toThrow(/newer version/);
      store.discardCorrupt();
      expect(store.readOnly).toBe(true);
      expect(storage.data.get(KEY)).toBe(raw);
      expect([...storage.data.keys()]).toEqual([KEY]);
    });

    it("backs up a file with dropped entries before the first write", () => {
      const storage = createMemoryStorage();
      const raw = JSON.stringify({
        version: 1,
        locations: [
          { id: "a", name: "A", lat: 1, lon: 1 },
          { id: "b", name: "x".repeat(61), lat: 1, lon: 1 },
        ],
      });
      storage.data.set(KEY, raw);
      const store = createLocationStore({ storage });
      expect(store.dropped).toBe(1);
      store.rename("a", "AA");
      expect(storage.data.get(`${KEY}.corrupt`)).toBe(raw);
      expect(storage.data.get(KEY)).not.toContain('"b"');
    });

    it("pauses changes when the dropped-entries backup fails", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const raw = JSON.stringify({
        version: 1,
        locations: [
          { id: "a", name: "A", lat: 1, lon: 1 },
          { id: "b", name: "", lat: 1, lon: 1 },
        ],
      });
      const storage = createMemoryStorage({ quotaBytes: raw.length + 40 });
      storage.data.set(KEY, raw);
      const store = createLocationStore({ storage });
      expect(store.readOnly).toBe(true);
      expect(() => store.rename("a", "AA")).toThrow(/backed up/);
      expect(storage.data.get(KEY)).toBe(raw);
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

  describe("review fixes", () => {
    const backupFailure = (raw: string) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const storage = createMemoryStorage({
        quotaBytes: raw.length + KEY.length + 20,
      });
      storage.data.set(KEY, raw);
      return { storage, store: createLocationStore({ storage }) };
    };

    it("discardCorrupt keeps valid entries when only some were dropped", () => {
      const raw = JSON.stringify({
        version: 1,
        locations: [
          { id: "a", name: "Valid A", lat: 1, lon: 1 },
          { id: "c", name: "Valid C", lat: 3, lon: 3 },
          { id: "b", name: "", lat: 1, lon: 1 },
        ],
      });
      const { store } = backupFailure(raw);
      expect(store.readOnlyKind).toBe("backup");
      expect(store.corrupt).toBe(false);
      store.discardCorrupt();
      expect(store.readOnly).toBe(false);
      expect(store.list().map((l) => l.id)).toEqual(["a", "c"]);
    });

    it("discardCorrupt empties the list when the data was unreadable", () => {
      const { store } = backupFailure(
        `{"version":1,"locations":[${"x".repeat(50)}`,
      );
      expect(store.readOnlyKind).toBe("backup");
      store.discardCorrupt();
      expect(store.list()).toEqual([]);
      expect(store.corrupt).toBe(false);
    });

    it("merges on top of another tab's write", () => {
      const storage = createMemoryStorage();
      const a = createLocationStore({ storage });
      const b = createLocationStore({ storage });
      a.add({ name: "FromA", lat: 1, lon: 1 });
      const other = createLocationStore({ storage: createMemoryStorage() });
      other.add({ name: "Imported", lat: 3, lon: 3 });
      other.add({ name: "FromA", lat: 1, lon: 1 });
      const result = b.merge(other.list());
      expect(result).toMatchObject({ added: 1, skipped: 1 });
      expect(b.list().map((l) => l.name)).toEqual(["FromA", "Imported"]);
      const saved = JSON.parse(storage.data.get(KEY) ?? "");
      expect(saved.locations).toHaveLength(2);
    });

    it("keeps suffixed ids within 45 characters and stable", () => {
      const long = "a".repeat(45);
      const store = createLocationStore({ storage: createMemoryStorage() });
      const incoming = (id: string) => ({
        id,
        name: id.slice(0, 5),
        lat: 1,
        lon: Number(id.length),
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      store.replaceAll([incoming(long)]);
      store.merge([
        { ...incoming(long), lon: 9 },
        { ...incoming(long), lon: 8 },
      ]);
      const ids = store.list().map((l) => l.id);
      expect(ids[0]).toBe(long);
      expect(ids[1]).toBe(`${"a".repeat(43)}-2`);
      expect(ids[2]).toBe(`${"a".repeat(43)}-3`);
      expect(ids.every((id) => id.length <= 45)).toBe(true);
      const again = createLocationStore({ storage: createMemoryStorage() });
      again.replaceAll(store.list());
      expect(again.list().map((l) => l.id)).toEqual(ids);
    });

    it("reports a distinct reason when every backup slot is used", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const storage = createMemoryStorage();
      for (const raw of ["{a", "{b", "{c", "{d"]) {
        storage.data.set(KEY, raw);
        createLocationStore({ storage });
      }
      const store = createLocationStore({ storage });
      expect(store.readOnlyKind).toBe("backups-full");
      expect(store.readOnlyReason).toMatch(/Too many saved backups/);
      expect(store.listBackups()).toEqual([
        { key: `${KEY}.corrupt`, size: 2 },
        { key: `${KEY}.corrupt-2`, size: 2 },
        { key: `${KEY}.corrupt-3`, size: 2 },
      ]);
      store.clearBackups();
      expect(store.listBackups()).toEqual([{ key: `${KEY}.corrupt`, size: 2 }]);
      expect(storage.data.get(`${KEY}.corrupt`)).toBe("{d");
      expect(store.readOnly).toBe(false);
      expect(storage.data.get(KEY)).toBe("{d");
    });

    it("re-backs up current data after backups are cleared", () => {
      const storage = createMemoryStorage();
      storage.data.set(KEY, "{bad");
      const store = createLocationStore({ storage });
      store.clearBackups();
      expect(storage.data.get(`${KEY}.corrupt`)).toBe("{bad");
    });

    it("checks existence against fresh data for rename and remove", () => {
      const storage = createMemoryStorage();
      const a = createLocationStore({ storage });
      const b = createLocationStore({ storage });
      a.add(home);
      expect(b.rename("home", "Cabin").name).toBe("Cabin");
      a.add({ name: "Two", lat: 2, lon: 2 });
      expect(b.remove("two")).toBe(true);
      expect(b.remove("two")).toBe(false);
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

    it("isolates throwing listeners from the caller and other listeners", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const store = createLocationStore({ storage: createMemoryStorage() });
      const second = vi.fn();
      store.subscribe(() => {
        throw new Error("render bug");
      });
      store.subscribe(second);
      expect(() => store.add(home)).not.toThrow();
      expect(store.list()).toHaveLength(1);
      expect(second).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
    });

    it("skips listeners unsubscribed during a notification", () => {
      const store = createLocationStore({ storage: createMemoryStorage() });
      const later = vi.fn();
      let off = () => {};
      store.subscribe(() => off());
      off = store.subscribe(later);
      store.add(home);
      expect(later).not.toHaveBeenCalled();
    });

    it("lets a listener change the store without losing either change", () => {
      const store = createLocationStore({ storage: createMemoryStorage() });
      store.subscribe(() => {
        if (store.list().length === 1) {
          store.add({ name: "Auto", lat: 2, lon: 2 });
        }
      });
      store.add(home);
      expect(store.list().map((l) => l.id)).toEqual(["home", "auto"]);
    });

    it("applies changes on top of another tab's write", () => {
      const storage = createMemoryStorage();
      const a = createLocationStore({ storage });
      const b = createLocationStore({ storage });
      a.add({ name: "FromA", lat: 1, lon: 1 });
      b.add({ name: "FromB", lat: 2, lon: 2 });
      expect(b.list().map((l) => l.name)).toEqual(["FromA", "FromB"]);
      const saved = JSON.parse(storage.data.get(KEY) ?? "");
      expect(saved.locations.map((l: { name: string }) => l.name)).toEqual([
        "FromA",
        "FromB",
      ]);
    });

    it("returns copies that cannot alter the store", () => {
      const store = createLocationStore({ storage: createMemoryStorage() });
      const meta = sampleMeta();
      store.add({ ...home, nws: meta });
      meta.gridId = "MUTATED";
      const got = store.get("home");
      got?.nws?.stationIds.push("X");
      expect(store.get("home")?.nws?.gridId).not.toBe("MUTATED");
      expect(store.get("home")?.nws?.stationIds).toEqual(["KCNK", "KMYZ"]);
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
