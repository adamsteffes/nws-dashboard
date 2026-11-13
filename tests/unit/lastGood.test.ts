import { createStore, set } from "idb-keyval";
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
    // put warns twice: once for the write and once for its follow-up prune.
    expect(warn).toHaveBeenCalledTimes(6);
  });

  it("treats missing or unparseable fetchedAt as oldest when pruning", async () => {
    const store = freshStore();
    let t = 1_000_000;
    const lg = createLastGood({ store, clock: () => t, maxEntries: 2 });
    await lg.put("a", "a", 1000);
    t += 1000;
    await lg.put("b", "b", 1000);
    // Corrupt the index: "a" gets an unparseable stamp, "z" has no index entry.
    await set(
      "__meta__",
      { a: "garbage", b: new Date(t).toISOString() },
      store,
    );
    await set("z", { value: "z", fetchedAt: "x", expiresAt: "x" }, store);
    await createLastGood({ store, maxEntries: 1 }).prune();
    expect(await lg.get("a")).toBeUndefined();
    expect(await lg.get("z")).toBeUndefined();
    expect((await lg.get<string>("b"))?.value).toBe("b");
  });

  it("keeps a concurrently refreshed key when pruning", async () => {
    const store = freshStore();
    let t = 1_000_000;
    const lg = createLastGood({ store, clock: () => t, maxEntries: 2 });
    await lg.put("a", "a1", 1000);
    t += 1000;
    await lg.put("b", "b", 1000);
    t += 1000;
    await Promise.all([lg.put("c", "c", 1000), lg.put("a", "a2", 1000)]);
    await lg.prune();
    expect((await lg.get<string>("a"))?.value).toBe("a2");
  });

  it("deleteByPrefix updates the index so later prunes stay correct", async () => {
    const store = freshStore();
    let t = 1_000_000;
    const lg = createLastGood({ store, clock: () => t, maxEntries: 3 });
    for (const key of ["x:1", "y:1", "y:2"]) {
      await lg.put(key, key, 1000);
      t += 1000;
    }
    await lg.deleteByPrefix("y:");
    await lg.put("w", "w", 1000);
    expect((await lg.get<string>("x:1"))?.value).toBe("x:1");
    expect((await lg.get<string>("w"))?.value).toBe("w");
  });

  it("swallows asynchronously rejecting stores", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rejecting = (() =>
      Promise.reject(new Error("quota"))) as unknown as ReturnType<
      typeof createStore
    >;
    const lg = createLastGood({ store: rejecting });
    expect(await lg.get("k")).toBeUndefined();
    await expect(lg.put("k", 1, 1000)).resolves.toBeUndefined();
    await expect(lg.deleteByPrefix("k")).resolves.toBeUndefined();
    await expect(lg.clear()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("logs prune failures as prune, not put", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const real = freshStore();
    let calls = 0;
    // First transaction (the put) works; the second (the prune) fails.
    const flaky = ((mode, cb) => {
      if (++calls > 1) return Promise.reject(new Error("prune boom"));
      return real(mode, cb);
    }) as ReturnType<typeof createStore>;
    const lg = createLastGood({ store: flaky });
    await lg.put("k", 1, 1000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe("last-good prune failed");
  });

  it("does not throw when indexedDB is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("indexedDB", undefined);
    try {
      const lg = createLastGood();
      expect(await lg.get("k")).toBeUndefined();
      await expect(lg.put("k", 1, 1000)).resolves.toBeUndefined();
      await expect(lg.clear()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
