import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parsePoint } from "../../src/nws/points";
import { createLocationStore, metaFromPoint } from "../../src/store/locations";
import {
  exportLocations,
  importLocations,
  validateLocationsFile,
} from "../../src/store/transfer";
import { createMemoryStorage } from "../helpers/memoryStorage";

const T = Date.parse("2026-11-14T12:00:00Z");

const meta = () =>
  metaFromPoint(
    parsePoint(
      JSON.parse(
        readFileSync(
          join(
            import.meta.dirname,
            "..",
            "fixtures",
            "nws",
            "points_linn-ks.json",
          ),
          "utf-8",
        ),
      ),
    ),
    ["KCNK"],
    new Date(T),
  );

const freshStore = () =>
  createLocationStore({ storage: createMemoryStorage(), clock: () => T });

const minimal = {
  locations: [{ name: "Home", lat: 39.7, lon: -97.1 }],
};

describe("exportLocations", () => {
  it("names the file by local date and pretty-prints a version 1 file", () => {
    const store = freshStore();
    store.add({ name: "Home", lat: 39.7, lon: -97.1 });
    const { filename, json } = exportLocations(
      store,
      new Date(2026, 10, 4, 9, 0),
    );
    expect(filename).toBe("nws-dashboard-locations-2026-11-04.json");
    expect(json).toContain('\n  "version": 1,');
    expect(JSON.parse(json)).toEqual({ version: 1, locations: store.list() });
  });

  it("round-trips through import in replace mode", () => {
    const source = freshStore();
    source.add({ name: "Home", lat: 39.7456, lon: -97.0892, nws: meta() });
    source.add({ name: "Home", lat: 25.7, lon: -80.2 });
    const { json } = exportLocations(source, new Date(T));

    const target = freshStore();
    target.add({ name: "Old", lat: 1, lon: 1 });
    const result = importLocations(target, json, "replace");
    expect(result).toEqual({ added: 2, replaced: 1, skipped: 0, warnings: [] });
    expect(target.list()).toEqual(source.list());
  });
});

describe("validateLocationsFile", () => {
  it("accepts a minimal hand-written file", () => {
    const result = validateLocationsFile(JSON.stringify(minimal));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.file.version).toBe(1);
    expect(result.file.locations).toHaveLength(1);
    const [loc] = result.file.locations;
    expect(loc).toMatchObject({ id: "home", name: "Home", lat: 39.7 });
    expect(typeof loc?.createdAt).toBe("string");
    expect(loc?.nws).toBeUndefined();
  });

  it("accepts an already parsed object", () => {
    expect(validateLocationsFile(minimal).ok).toBe(true);
  });

  it("rejects non-JSON strings", () => {
    const result = validateLocationsFile("hello");
    expect(result).toEqual({
      ok: false,
      error: "That file isn't a locations backup: it isn't valid JSON.",
    });
  });

  it("rejects missing or wrongly typed locations", () => {
    for (const input of [{}, { locations: "x" }, [], null, 5]) {
      const result = validateLocationsFile(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/^That file isn't a/);
    }
  });

  it("rejects newer versions with a clear message", () => {
    const result = validateLocationsFile({ version: 2, locations: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/version 2.*Update the app/);
  });

  it("drops invalid entries with index and reason", () => {
    const result = validateLocationsFile({
      locations: [
        { name: "Good", lat: 1, lon: 2 },
        { name: "", lat: 1, lon: 2 },
        { name: "Far", lat: 95, lon: 2 },
        { name: "Str", lat: "1", lon: 2 },
        42,
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.locations.map((l) => l.name)).toEqual(["Good"]);
    expect(result.warnings).toHaveLength(4);
    expect(result.warnings[0]).toMatch(/index 1.*Name/);
    expect(result.warnings[1]).toMatch(/index 2.*Latitude/);
    expect(result.warnings[3]).toMatch(/index 4/);
  });

  it("keeps the entry but drops a malformed nws block", () => {
    const result = validateLocationsFile({
      locations: [{ name: "Home", lat: 1, lon: 2, nws: { gridId: "TOP" } }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.locations).toHaveLength(1);
    expect(result.file.locations[0]?.nws).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/index 0.*NWS/);
  });

  it("keeps a well-formed nws block", () => {
    const result = validateLocationsFile({
      locations: [{ name: "Home", lat: 1, lon: 2, nws: meta() }],
    });
    expect(result.ok && result.file.locations[0]?.nws).toEqual(meta());
  });

  it("makes duplicate ids in the file unique", () => {
    const result = validateLocationsFile({
      locations: [
        { id: "a", name: "A", lat: 1, lon: 2 },
        { id: "a", name: "B", lat: 3, lon: 4 },
      ],
    });
    expect(result.ok && result.file.locations.map((l) => l.id)).toEqual([
      "a",
      "a-2",
    ]);
  });
});

describe("importLocations", () => {
  const entry = (id: string, name: string, lat: number, lon: number) => ({
    id,
    name,
    lat,
    lon,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  it("merge gives colliding ids a new id and skips exact duplicates", () => {
    const store = freshStore();
    store.add({ name: "Home", lat: 39.7, lon: -97.1 });
    const result = importLocations(
      store,
      {
        locations: [
          entry("home", "Home", 39.7, -97.1),
          entry("home", "Cabin", 40, -98),
          entry("new", "Other", 41, -99),
        ],
      },
      "merge",
    );
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.replaced).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/"home-2"/);
    expect(store.list().map((l) => [l.id, l.name])).toEqual([
      ["home", "Home"],
      ["home-2", "Cabin"],
      ["new", "Other"],
    ]);
  });

  it("merge keeps same-name entries at different coordinates", () => {
    const store = freshStore();
    store.add({ name: "Home", lat: 39.7, lon: -97.1 });
    const result = importLocations(
      store,
      { locations: [{ name: "Home", lat: 25, lon: -80 }] },
      "merge",
    );
    expect(result.added).toBe(1);
    expect(store.list().map((l) => l.id)).toEqual(["home", "home-2"]);
  });

  it("replace discards existing locations", () => {
    const store = freshStore();
    store.add({ name: "Old", lat: 1, lon: 1 });
    store.add({ name: "Older", lat: 2, lon: 2 });
    const result = importLocations(store, minimal, "replace");
    expect(result).toMatchObject({ added: 1, replaced: 2, skipped: 0 });
    expect(store.list().map((l) => l.name)).toEqual(["Home"]);
  });

  it("surfaces validation warnings", () => {
    const store = freshStore();
    const result = importLocations(
      store,
      { locations: [{ name: "", lat: 0, lon: 0 }, ...minimal.locations] },
      "merge",
    );
    expect(result.added).toBe(1);
    expect(result.warnings).toHaveLength(1);
  });

  it("throws instead of reporting success when the save fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createLocationStore({
      storage: createMemoryStorage({ quotaBytes: 300 }),
    });
    store.add({ name: "Keep", lat: 1, lon: 1 });
    const before = store.list();
    const big = {
      locations: Array.from({ length: 20 }, (_, i) => ({
        name: `N${i}`,
        lat: 1,
        lon: i,
      })),
    };
    expect(() => importLocations(store, big, "replace")).toThrow(
      /Couldn't save/,
    );
    expect(() => importLocations(store, big, "merge")).toThrow(/Couldn't save/);
    expect(store.list()).toEqual(before);
  });

  it("regenerates unusable ids", () => {
    const result = validateLocationsFile({
      locations: [
        { id: "__proto__", name: "A", lat: 1, lon: 1 },
        { id: "../evil <b>", name: "B", lat: 1, lon: 2 },
        { id: "z".repeat(100), name: "C", lat: 1, lon: 3 },
      ],
    });
    expect(result.ok && result.file.locations.map((l) => l.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(result.ok && result.warnings).toHaveLength(3);
  });

  it("replaces invalid createdAt values", () => {
    const result = validateLocationsFile({
      locations: [{ name: "A", lat: 1, lon: 1, createdAt: "2026" }],
    });
    expect(result.ok && result.file.locations[0]?.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
  });

  it("rejects oversized files", () => {
    const tooLong = `{"locations":[],"pad":"${"x".repeat(1_000_001)}"}`;
    const many = {
      locations: Array.from({ length: 501 }, (_, i) => ({
        name: `N${i}`,
        lat: 1,
        lon: 1,
      })),
    };
    for (const input of [tooLong, many]) {
      const result = validateLocationsFile(input);
      expect(result.ok).toBe(false);
    }
    const store = freshStore();
    expect(() => importLocations(store, many, "merge")).toThrow(
      /more than 500/,
    );
  });

  it("leaves the store unchanged on a hard error", () => {
    const store = freshStore();
    store.add({ name: "Keep", lat: 1, lon: 1 });
    const before = store.list();
    for (const mode of ["merge", "replace"] as const) {
      expect(() => importLocations(store, "not json", mode)).toThrow(
        /isn't a locations backup/,
      );
      expect(() =>
        importLocations(store, { version: 2, locations: [] }, mode),
      ).toThrow(/version 2/);
    }
    expect(store.list()).toEqual(before);
  });
});
