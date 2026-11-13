import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createSingleFlight,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  MIN_TTL_MS,
  TtlCache,
  ttlFromHeaders,
} from "../../src/nws/cache";

const sidecar = (name: string): Record<string, string> =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "fixtures", "nws", name),
      "utf-8",
    ),
  ).headers;

describe("ttlFromHeaders", () => {
  const now = Date.parse("2026-11-13T08:11:00Z");

  it.each([
    ["alerts_active_linn-ks.headers.json", MIN_TTL_MS],
    ["alerts_active_miami-fl.headers.json", MIN_TTL_MS],
    ["obs_latest_linn-ks_KCNK.headers.json", 300_000],
    ["obs_latest_miami-fl_KOPF.headers.json", 152_000],
    ["forecast_linn-ks.headers.json", 3_600_000],
    ["forecast_miami-fl.headers.json", 1_588_000],
    ["points_linn-ks.headers.json", 76_770_000],
    ["stations_linn-ks.headers.json", MAX_TTL_MS],
  ])("%s -> %i ms", (file, expected) => {
    expect(ttlFromHeaders(sidecar(file), now)).toBe(expected);
  });

  it("accepts a Headers instance", () => {
    const headers = new Headers({ "Cache-Control": "public, max-age=600" });
    expect(ttlFromHeaders(headers, now)).toBe(600_000);
  });

  it("matches header names case-insensitively in plain records", () => {
    expect(ttlFromHeaders({ "Cache-Control": "max-age=600" }, now)).toBe(
      600_000,
    );
  });

  it("clamps large max-age to 24 h", () => {
    expect(ttlFromHeaders({ "cache-control": "max-age=999999" }, now)).toBe(
      MAX_TTL_MS,
    );
  });

  it("ignores s-maxage", () => {
    expect(ttlFromHeaders({ "cache-control": "s-maxage=3600" }, now)).toBe(
      DEFAULT_TTL_MS,
    );
  });

  it("uses Expires minus Date when there is no max-age", () => {
    expect(
      ttlFromHeaders(
        {
          expires: "Fri, 13 Nov 2026 09:00:00 GMT",
          date: "Fri, 13 Nov 2026 08:00:00 GMT",
        },
        now,
      ),
    ).toBe(3_600_000);
  });

  it("uses Expires minus now when Date is missing", () => {
    expect(
      ttlFromHeaders({ expires: "Fri, 13 Nov 2026 08:21:00 GMT" }, now),
    ).toBe(600_000);
  });

  it("clamps an Expires in the past to the minimum", () => {
    expect(
      ttlFromHeaders({ expires: "Fri, 13 Nov 2026 07:00:00 GMT" }, now),
    ).toBe(MIN_TTL_MS);
  });

  it("falls back to the default when nothing is usable", () => {
    expect(ttlFromHeaders({}, now)).toBe(DEFAULT_TTL_MS);
    expect(ttlFromHeaders({ expires: "garbage" }, now)).toBe(DEFAULT_TTL_MS);
  });

  it.each(["no-store", "no-cache", "public, no-cache, max-age=3600"])(
    "%s -> minimum",
    (value) => {
      expect(ttlFromHeaders({ "cache-control": value }, now)).toBe(MIN_TTL_MS);
    },
  );
});

describe("TtlCache", () => {
  function setup(maxEntries?: number) {
    let t = 1_000;
    const cache = new TtlCache<string>({ clock: () => t, maxEntries });
    return {
      cache,
      advance: (ms: number) => {
        t += ms;
      },
    };
  }

  it("returns fresh values and expires them", () => {
    const { cache, advance } = setup();
    cache.set("a", "A", 1000);
    expect(cache.get("a")).toBe("A");
    advance(999);
    expect(cache.get("a")).toBe("A");
    advance(1);
    expect(cache.get("a")).toBeUndefined();
  });

  it("returns undefined for unknown keys", () => {
    const { cache } = setup();
    expect(cache.get("nope")).toBeUndefined();
    expect(cache.getStale("nope")).toBeUndefined();
  });

  it("returns expired entries from getStale", () => {
    const { cache, advance } = setup();
    cache.set("a", "A", 1000);
    advance(5000);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.getStale("a")).toEqual({
      value: "A",
      storedAt: 1000,
      expiresAt: 2000,
    });
  });

  it("evicts the least recently used entry", () => {
    const { cache } = setup(3);
    cache.set("a", "A", 10_000);
    cache.set("b", "B", 10_000);
    cache.set("c", "C", 10_000);
    cache.get("a");
    cache.set("d", "D", 10_000);
    expect(cache.size).toBe(3);
    expect(cache.getStale("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");
    expect(cache.get("d")).toBe("D");
  });

  it("overwriting a key refreshes its recency and value", () => {
    const { cache } = setup(2);
    cache.set("a", "A", 10_000);
    cache.set("b", "B", 10_000);
    cache.set("a", "A2", 10_000);
    cache.set("c", "C", 10_000);
    expect(cache.getStale("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A2");
  });

  it("deletes by key, prefix, and clear", () => {
    const { cache } = setup();
    cache.set("points:1", "p1", 10_000);
    cache.set("points:2", "p2", 10_000);
    cache.set("alerts:1", "a1", 10_000);
    cache.delete("alerts:1");
    expect(cache.size).toBe(2);
    cache.set("alerts:1", "a1", 10_000);
    cache.deleteByPrefix("points:");
    expect(cache.size).toBe(1);
    expect(cache.get("alerts:1")).toBe("a1");
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe("createSingleFlight", () => {
  it("shares one in-flight promise between concurrent callers", async () => {
    const singleFlight = createSingleFlight();
    let resolve: (v: string) => void = () => {};
    const factory = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const calls = Array.from({ length: 10 }, () => singleFlight("k", factory));
    resolve("result");
    const results = await Promise.all(calls);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(results).toEqual(Array(10).fill("result"));
  });

  it("runs different keys independently", async () => {
    const singleFlight = createSingleFlight();
    const factory = vi.fn(async () => 1);
    await Promise.all([singleFlight("a", factory), singleFlight("b", factory)]);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("runs the factory again after a resolved call", async () => {
    const singleFlight = createSingleFlight();
    const factory = vi.fn(async () => 1);
    await singleFlight("k", factory);
    await singleFlight("k", factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("allows a retry after rejection", async () => {
    const singleFlight = createSingleFlight();
    const factory = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    const first = singleFlight("k", factory);
    const second = singleFlight("k", factory);
    await expect(first).rejects.toThrow("boom");
    await expect(second).rejects.toThrow("boom");
    expect(factory).toHaveBeenCalledTimes(1);
    await expect(singleFlight("k", factory)).resolves.toBe("ok");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("turns a synchronously throwing factory into a rejection", async () => {
    const singleFlight = createSingleFlight();
    await expect(
      singleFlight("k", () => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
    await expect(singleFlight("k", async () => "ok")).resolves.toBe("ok");
  });
});
