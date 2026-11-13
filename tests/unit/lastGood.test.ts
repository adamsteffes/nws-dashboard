import { createStore } from "idb-keyval";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLastGood } from "../../src/store/lastGood";

let dbCounter = 0;
// A unique database per test keeps tests independent of each other.
const freshStore = () => createStore(`test-db-${dbCounter++}`, "last-good");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLastGood", () => {
  it("round-trips a value with ISO timestamps", async () => {
    const t = Date.parse("2026-11-13T08:00:00Z");
    const lg = createLastGood({ store: freshStore(), clock: () => t });
    await lg.put("forecast:1", { temp: 70 }, 60_000);
    expect(await lg.get("forecast:1")).toEqual({
      value: { temp: 70 },
      fetchedAt: "2026-11-13T08:00:00.000Z",
      expiresAt: "2026-11-13T08:01:00.000Z",
    });
  });

  it("returns undefined for a missing key", async () => {
    const lg = createLastGood({ store: freshStore() });
    expect(await lg.get("missing")).toBeUndefined();
  });

  it("returns entries even after they expire", async () => {
    let t = 0;
    const lg = createLastGood({ store: freshStore(), clock: () => t });
    await lg.put("k", "v", 1000);
    t = 10_000_000;
    expect((await lg.get<string>("k"))?.value).toBe("v");
  });

  it("prunes the oldest entries beyond maxEntries on put", async () => {
    let t = 1_000_000;
    const lg = createLastGood({
      store: freshStore(),
      clock: () => t,
      maxEntries: 3,
    });
    for (const key of ["a", "b", "c", "d", "e"]) {
      await lg.put(key, key, 1000);
      t += 1000;
    }
    expect(await lg.get("a")).toBeUndefined();
    expect(await lg.get("b")).toBeUndefined();
    expect((await lg.get<string>("c"))?.value).toBe("c");
    expect((await lg.get<string>("d"))?.value).toBe("d");
    expect((await lg.get<string>("e"))?.value).toBe("e");
  });

  it("prune() trims an over-full store", async () => {
    const store = freshStore();
    let t = 1_000_000;
    const big = createLastGood({ store, clock: () => t, maxEntries: 10 });
    for (const key of ["a", "b", "c"]) {
      await big.put(key, key, 1000);
      t += 1000;
    }
    await createLastGood({ store, maxEntries: 1 }).prune();
    expect(await big.get("a")).toBeUndefined();
    expect(await big.get("b")).toBeUndefined();
    expect((await big.get<string>("c"))?.value).toBe("c");
  });

  it("deletes by prefix", async () => {
    const lg = createLastGood({ store: freshStore() });
    await lg.put("points:1", 1, 1000);
    await lg.put("points:2", 2, 1000);
    await lg.put("alerts:1", 3, 1000);
    await lg.deleteByPrefix("points:");
    expect(await lg.get("points:1")).toBeUndefined();
    expect(await lg.get("points:2")).toBeUndefined();
    expect((await lg.get<number>("alerts:1"))?.value).toBe(3);
  });

  it("clears everything", async () => {
    const lg = createLastGood({ store: freshStore() });
    await lg.put("a", 1, 1000);
    await lg.put("b", 2, 1000);
    await lg.clear();
    expect(await lg.get("a")).toBeUndefined();
    expect(await lg.get("b")).toBeUndefined();
  });

  it("swallows and warns about storage errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = (() => {
      throw new Error("storage unavailable");
    }) as unknown as ReturnType<typeof createStore>;
    const lg = createLastGood({ store: broken });

    expect(await lg.get("k")).toBeUndefined();
    await expect(lg.put("k", 1, 1000)).resolves.toBeUndefined();
    await expect(lg.prune()).resolves.toBeUndefined();
    await expect(lg.deleteByPrefix("k")).resolves.toBeUndefined();
    await expect(lg.clear()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(5);
  });
});
