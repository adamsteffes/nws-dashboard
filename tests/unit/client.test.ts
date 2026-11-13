import { describe, expect, it } from "vitest";
import { createNwsClient, type NwsClientOptions } from "../../src/nws/client";
import {
  NwsError,
  NwsNotFound,
  NwsOfflineError,
  parseProblem,
} from "../../src/nws/errors";
import type { LastGood, LastGoodEntry } from "../../src/store/lastGood";
import { createFakeFetch, type Routes } from "../helpers/fakeFetch";

const FORECAST = "https://api.weather.gov/gridpoints/TOP/32,81/forecast";
const POINTS = "https://api.weather.gov/points/39.7456,-97.0892";
const T0 = Date.parse("2026-11-13T08:11:01Z");

function fakeLastGood(seed: Record<string, unknown> = {}) {
  const entries = new Map<string, LastGoodEntry<unknown>>();
  for (const [key, value] of Object.entries(seed)) {
    entries.set(key, {
      value,
      fetchedAt: "2026-11-12T00:00:00.000Z",
      expiresAt: "2026-11-12T01:00:00.000Z",
    });
  }
  const lastGood: LastGood = {
    async get<T>(key: string) {
      return entries.get(key) as LastGoodEntry<T> | undefined;
    },
    async put<T>(key: string, value: T, ttlMs: number) {
      entries.set(key, {
        value,
        fetchedAt: new Date(T0).toISOString(),
        expiresAt: new Date(T0 + ttlMs).toISOString(),
      });
    },
    async prune() {},
    async deleteByPrefix(prefix: string) {
      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },
    async clear() {
      entries.clear();
    },
  };
  return { lastGood, entries };
}

function setup(
  routes: Routes,
  extra: Partial<NwsClientOptions> & { seed?: Record<string, unknown> } = {},
) {
  const { seed, ...clientOpts } = extra;
  const fetchFn = createFakeFetch(routes);
  const state = { now: T0 };
  const delays: number[] = [];
  const store = fakeLastGood(seed);
  const client = createNwsClient({
    fetchFn,
    clock: () => state.now,
    sleep: async (ms) => {
      delays.push(ms);
    },
    lastGood: store.lastGood,
    isOnline: () => true,
    ...clientOpts,
  });
  return { client, fetchFn, state, delays, ...store };
}

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected promise to reject");
};

describe("parseProblem", () => {
  it("extracts title, detail and correlationId", () => {
    expect(
      parseProblem({ title: "T", detail: "D", correlationId: "c", status: 1 }),
    ).toEqual({ title: "T", detail: "D", correlationId: "c" });
  });

  it("returns an empty object for non-objects", () => {
    expect(parseProblem(null)).toEqual({});
    expect(parseProblem("nope")).toEqual({});
  });
});

describe("request shape", () => {
  it("sends only the Accept header, cors mode and default cache", async () => {
    const { client, fetchFn } = setup({ [FORECAST]: "forecast_linn-ks" });
    await client.getJson(FORECAST);
    const init = fetchFn.calls[0]?.init;
    expect(init?.headers).toEqual({ Accept: "application/geo+json" });
    expect(init?.cache).toBe("default");
    expect(init?.mode).toBe("cors");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses no-cache on refresh", async () => {
    const { client, fetchFn } = setup({ [FORECAST]: "forecast_linn-ks" });
    await client.getJson(FORECAST, { refresh: true });
    expect(fetchFn.calls[0]?.init?.cache).toBe("no-cache");
  });
});

describe("caching", () => {
  it("serves a fresh entry without fetching again", async () => {
    const { client, fetchFn, state } = setup({
      [FORECAST]: "forecast_linn-ks",
    });
    const first = await client.getJson(FORECAST);
    state.now += 60_000;
    const second = await client.getJson(FORECAST);
    expect(fetchFn.calls).toHaveLength(1);
    expect(second).toEqual({ ...first, stale: false });
    expect(second.fetchedAt).toBe(new Date(T0).toISOString());
  });

  it("refetches once the max-age from the recorded headers has passed", async () => {
    const { client, fetchFn, state } = setup({
      [FORECAST]: ["forecast_linn-ks", "forecast_linn-ks"],
    });
    await client.getJson(FORECAST);
    state.now += 3_600_000 - 1;
    await client.getJson(FORECAST);
    expect(fetchFn.calls).toHaveLength(1);
    state.now += 2;
    const again = await client.getJson(FORECAST);
    expect(fetchFn.calls).toHaveLength(2);
    expect(again.fetchedAt).toBe(new Date(state.now).toISOString());
  });

  it("refresh bypasses a fresh memory entry", async () => {
    const { client, fetchFn } = setup({
      [FORECAST]: ["forecast_linn-ks", "forecast_linn-ks"],
    });
    await client.getJson(FORECAST);
    await client.getJson(FORECAST, { refresh: true });
    expect(fetchFn.calls).toHaveLength(2);
  });

  it("writes successful responses to last-good", async () => {
    const { client, entries } = setup({ [FORECAST]: "forecast_linn-ks" });
    const { data } = await client.getJson(FORECAST);
    await Promise.resolve();
    expect(entries.get(FORECAST)?.value).toEqual(data);
  });

  it("round-trips a recorded points fixture", async () => {
    const { client } = setup({ [POINTS]: "points_linn-ks" });
    const { data, stale } = await client.getJson<{
      properties: { gridId: string };
    }>(POINTS);
    expect(data.properties.gridId).toBe("TOP");
    expect(stale).toBe(false);
  });
});

describe("retries", () => {
  it("retries 503 with exponential backoff until success", async () => {
    const { client, fetchFn, delays } = setup({
      [FORECAST]: [503, 503, { fixture: "forecast_linn-ks" }],
    });
    const result = await client.getJson(FORECAST);
    expect(result.stale).toBe(false);
    expect(fetchFn.calls).toHaveLength(3);
    expect(delays).toEqual([500, 1000]);
  });

  it("throws an NwsError with problem details when retries run out", async () => {
    const { client, fetchFn, delays } = setup({ [FORECAST]: [503, 503, 503] });
    const error = await failure(client.getJson(FORECAST));
    expect(error).toBeInstanceOf(NwsError);
    expect(error).not.toBeInstanceOf(NwsNotFound);
    const err = error as NwsError;
    expect(err.status).toBe(503);
    expect(err.title).toBe("Unexpected Problem");
    expect(err.detail).toBe("An unexpected problem has occurred.");
    expect(err.correlationId).toBe("00000000-test-500");
    expect(err.url).toBe(FORECAST);
    expect(fetchFn.calls).toHaveLength(3);
    expect(delays).toEqual([500, 1000]);
  });

  it("falls back to last-good as stale when retries run out", async () => {
    const { client } = setup(
      { [FORECAST]: [503, 503, 503] },
      { seed: { [FORECAST]: { old: true } } },
    );
    expect(await client.getJson(FORECAST)).toEqual({
      data: { old: true },
      fetchedAt: "2026-11-12T00:00:00.000Z",
      stale: true,
    });
  });

  it("falls back to an expired memory entry on refresh failure", async () => {
    const { client, state } = setup({
      [FORECAST]: ["forecast_linn-ks", 500, 500, 500],
    });
    const first = await client.getJson(FORECAST);
    state.now += 7_200_000;
    const second = await client.getJson(FORECAST);
    expect(second).toEqual({ ...first, stale: true });
  });

  it("honors Retry-After in seconds", async () => {
    const { client, delays } = setup({
      [FORECAST]: [
        { status: 429, headers: { "retry-after": "2" } },
        { fixture: "forecast_linn-ks" },
      ],
    });
    await client.getJson(FORECAST);
    expect(delays).toEqual([2000]);
  });

  it("honors Retry-After as an HTTP date", async () => {
    const { client, delays } = setup({
      [FORECAST]: [
        {
          status: 429,
          headers: { "retry-after": "Fri, 13 Nov 2026 08:11:04 GMT" },
        },
        { fixture: "forecast_linn-ks" },
      ],
    });
    await client.getJson(FORECAST);
    expect(delays).toEqual([3000]);
  });

  it("caps Retry-After at 5000 ms", async () => {
    const { client, delays } = setup({
      [FORECAST]: [
        { status: 429, headers: { "retry-after": "60" } },
        { fixture: "forecast_linn-ks" },
      ],
    });
    await client.getJson(FORECAST);
    expect(delays).toEqual([5000]);
  });

  it("retries network errors", async () => {
    const { client, fetchFn, delays } = setup({
      [FORECAST]: [
        new TypeError("Load failed"),
        { fixture: "forecast_linn-ks" },
      ],
    });
    await client.getJson(FORECAST);
    expect(fetchFn.calls).toHaveLength(2);
    expect(delays).toEqual([500]);
  });

  it("retries timeouts and reports status 0 when they persist", async () => {
    const { client, fetchFn } = setup({
      [FORECAST]: ["timeout", "timeout", "timeout"],
    });
    const error = (await failure(client.getJson(FORECAST))) as NwsError;
    expect(error).toBeInstanceOf(NwsError);
    expect(error.status).toBe(0);
    expect(fetchFn.calls).toHaveLength(3);
  });

  it("respects maxAttempts", async () => {
    const { client, fetchFn } = setup(
      { [FORECAST]: [503, 503] },
      { maxAttempts: 2 },
    );
    await failure(client.getJson(FORECAST));
    expect(fetchFn.calls).toHaveLength(2);
  });
});

describe("non-retried failures", () => {
  it("throws NwsNotFound after one call even when last-good exists", async () => {
    const { client, fetchFn } = setup(
      { [POINTS]: "points_404" },
      { seed: { [POINTS]: { old: true } } },
    );
    const error = await failure(client.getJson(POINTS));
    expect(error).toBeInstanceOf(NwsNotFound);
    const err = error as NwsNotFound;
    expect(err.status).toBe(404);
    expect(err.correlationId).toBe("00000000-test-404");
    expect(fetchFn.calls).toHaveLength(1);
  });

  it("does not retry other 4xx errors", async () => {
    const { client, fetchFn, delays } = setup({
      [FORECAST]: [
        { status: 400, body: { title: "Bad Request", status: 400 } },
      ],
    });
    const error = (await failure(client.getJson(FORECAST))) as NwsError;
    expect(error.status).toBe(400);
    expect(error.title).toBe("Bad Request");
    expect(fetchFn.calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it("does not retry invalid JSON and falls back to last-good", async () => {
    const { client, fetchFn } = setup(
      { [FORECAST]: [{ status: 200, body: "<html>" }] },
      { seed: { [FORECAST]: { old: true } } },
    );
    const result = await client.getJson(FORECAST);
    expect(result.stale).toBe(true);
    expect(result.data).toEqual({ old: true });
    expect(fetchFn.calls).toHaveLength(1);
  });

  it("throws Invalid JSON when nothing is cached", async () => {
    const { client } = setup({ [FORECAST]: [{ status: 200, body: "<html>" }] });
    const error = (await failure(client.getJson(FORECAST))) as NwsError;
    expect(error.status).toBe(200);
    expect(error.title).toBe("Invalid JSON");
  });
});

describe("offline", () => {
  it("returns last-good as stale without fetching", async () => {
    const { client, fetchFn } = setup(
      {},
      { isOnline: () => false, seed: { [FORECAST]: { old: true } } },
    );
    const result = await client.getJson(FORECAST);
    expect(result).toMatchObject({ data: { old: true }, stale: true });
    expect(fetchFn.calls).toHaveLength(0);
  });

  it("throws NwsOfflineError when nothing is stored", async () => {
    const { client, fetchFn } = setup({}, { isOnline: () => false });
    const error = await failure(client.getJson(FORECAST));
    expect(error).toBeInstanceOf(NwsOfflineError);
    expect((error as NwsOfflineError).status).toBe(0);
    expect(fetchFn.calls).toHaveLength(0);
  });
});

describe("concurrency", () => {
  type Deferred = { resolve: () => void };

  const deferredRoutes = (urls: string[]) => {
    const pending: Deferred[] = [];
    let inFlight = 0;
    let peak = 0;
    const routes: Routes = {};
    for (const url of urls) {
      routes[url] = () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        return new Promise<Response>((resolve) => {
          pending.push({
            resolve: () => {
              inFlight--;
              resolve(new Response("{}", { status: 200 }));
            },
          });
        });
      };
    }
    return { routes, pending, peak: () => peak };
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("shares one fetch between concurrent calls for the same URL", async () => {
    const d = deferredRoutes([FORECAST]);
    const { client, fetchFn } = setup(d.routes);
    const calls = Array.from({ length: 10 }, (_, i) =>
      client.getJson(FORECAST, { refresh: i % 2 === 0 }),
    );
    await settle();
    d.pending[0]?.resolve();
    const results = await Promise.all(calls);
    expect(fetchFn.calls).toHaveLength(1);
    expect(results.every((r) => r.stale === false)).toBe(true);
  });

  it("never runs more than 4 requests at once", async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `${FORECAST}?n=${i}`);
    const d = deferredRoutes(urls);
    const { client } = setup(d.routes);
    const calls = urls.map((url) => client.getJson(url));
    let done = 0;
    while (done < urls.length) {
      await settle();
      expect(d.pending.length - done).toBeLessThanOrEqual(4);
      const next = d.pending[done];
      if (!next) continue;
      next.resolve();
      done++;
    }
    await Promise.all(calls);
    expect(d.peak()).toBe(4);
  });
});

describe("clear and forget", () => {
  it("clear empties the memory cache", async () => {
    const { client, fetchFn } = setup({
      [FORECAST]: ["forecast_linn-ks", "forecast_linn-ks"],
    });
    await client.getJson(FORECAST);
    client.clear();
    await client.getJson(FORECAST);
    expect(fetchFn.calls).toHaveLength(2);
  });

  it("forget removes memory and last-good entries under a prefix", async () => {
    const other = "https://api.weather.gov/gridpoints/MFL/1,1/forecast";
    const { client, entries } = setup(
      { [FORECAST]: "forecast_linn-ks" },
      { isOnline: () => true, seed: { [other]: { keep: true } } },
    );
    await client.getJson(FORECAST);
    await Promise.resolve();
    expect(entries.has(FORECAST)).toBe(true);

    await client.forget("https://api.weather.gov/gridpoints/TOP/");
    expect(entries.has(FORECAST)).toBe(false);
    expect(entries.has(other)).toBe(true);

    const offline = setup({}, { isOnline: () => false });
    expect(await failure(offline.client.getJson(FORECAST))).toBeInstanceOf(
      NwsOfflineError,
    );
  });

  it("forget drops the memory entry so it is not served afterwards", async () => {
    let online = true;
    const { client } = setup(
      { [FORECAST]: "forecast_linn-ks" },
      { isOnline: () => online },
    );
    await client.getJson(FORECAST);
    await client.forget("https://api.weather.gov/gridpoints/TOP/");
    online = false;
    expect(await failure(client.getJson(FORECAST))).toBeInstanceOf(
      NwsOfflineError,
    );
  });
});
