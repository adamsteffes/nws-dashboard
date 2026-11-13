import { describe, expect, it } from "vitest";
import {
  buildUserAgent,
  fixtureName,
  parsePointArg,
  pickHeaders,
  record,
  roundCoord,
  summarizeFindings,
} from "../../scripts/record-fixtures.ts";

const API = "https://api.weather.gov";
const GEO = { "content-type": "application/geo+json" };

describe("helpers", () => {
  it("roundCoord rounds to 4 dp", () => {
    expect(roundCoord(39.74561234)).toBe(39.7456);
    expect(roundCoord(-97.08925)).toBe(-97.0893);
  });

  it("parsePointArg parses coords and label", () => {
    expect(parsePointArg("39.74561,-97.08921:Linn-KS")).toEqual({
      lat: 39.7456,
      lon: -97.0892,
      label: "linn-ks",
    });
    expect(parsePointArg("1.5,2.5").label).toBe("1.5_2.5");
  });

  it("parsePointArg rejects bad input", () => {
    expect(() => parsePointArg("abc")).toThrow();
    expect(() => parsePointArg("91,0")).toThrow();
    expect(() => parsePointArg("1,2:../x")).toThrow();
  });

  it("fixtureName composes names", () => {
    expect(fixtureName("points", "a")).toBe("points_a");
    expect(fixtureName("obs_latest", "a", "KXYZ")).toBe("obs_latest_a_KXYZ");
  });

  it("pickHeaders keeps only whitelisted headers", () => {
    const h = new Headers({
      "Cache-Control": "public, max-age=10",
      "Set-Cookie": "a=b",
      Server: "x",
      "Access-Control-Allow-Origin": "*",
    });
    expect(pickHeaders(h)).toEqual({
      "cache-control": "public, max-age=10",
      "access-control-allow-origin": "*",
    });
  });

  it("buildUserAgent appends contact only when set", () => {
    expect(buildUserAgent()).toBe(
      "nws-dashboard-fixture-recorder (https://github.com/adamsteffes/nws-dashboard)",
    );
    expect(buildUserAgent("me@example.com")).toMatch(/; me@example\.com$/);
  });

  it("summarizeFindings reports absent ACAO", () => {
    const text = summarizeFindings({ pointsHeaders: {}, cacheControl: {} });
    expect(text).toContain("NOT present");
  });
});

type Route = {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
};

function setup(routes: Record<string, Route | Route[]>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const counts: Record<string, number> = {};
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const entry = routes[url];
    if (!entry) return new Response("{}", { status: 404, headers: GEO });
    const n = counts[url] ?? 0;
    counts[url] = n + 1;
    const r = Array.isArray(entry)
      ? (entry[Math.min(n, entry.length - 1)] as Route)
      : entry;
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { ...GEO, ...r.headers },
    });
  };
  const files = new Map<string, string>();
  const writeFile = async (path: string, data: string) => {
    files.set(path, data);
  };
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  return { calls, fetchFn, files, writeFile, sleeps, sleep };
}

function happyRoutes(): Record<string, Route> {
  const cc = { "cache-control": "public, max-age=3600" };
  return {
    [`${API}/points/39.7456,-97.0892`]: {
      body: {
        properties: {
          cwa: "TOP",
          forecast: `${API}/gridpoints/TOP/1,1/forecast`,
          forecastHourly: `${API}/gridpoints/TOP/1,1/forecast/hourly`,
          observationStations: `${API}/gridpoints/TOP/1,1/stations`,
        },
      },
      headers: {
        ...cc,
        "access-control-allow-origin": "*",
        "set-cookie": "secret=1",
        server: "nginx",
      },
    },
    [`${API}/gridpoints/TOP/1,1/forecast`]: {
      body: { properties: {} },
      headers: cc,
    },
    [`${API}/gridpoints/TOP/1,1/forecast/hourly`]: {
      body: { properties: {} },
      headers: cc,
    },
    [`${API}/gridpoints/TOP/1,1/stations`]: {
      body: {
        features: [
          { properties: { stationIdentifier: "KAAA" } },
          { properties: { stationIdentifier: "KBBB" } },
          { properties: { stationIdentifier: "KCCC" } },
        ],
      },
    },
    [`${API}/stations/KAAA/observations/latest`]: { body: { properties: {} } },
    [`${API}/stations/KBBB/observations/latest`]: { body: { properties: {} } },
    [`${API}/alerts/active?point=39.7456,-97.0892`]: { body: { features: [] } },
    [`${API}/products/types/AFD/locations/TOP`]: {
      body: { "@graph": [{ id: "afd-123" }] },
    },
    [`${API}/products/afd-123`]: { body: { productText: "x" } },
  };
}

const point = parsePointArg("39.74561,-97.08921:linn-ks");
const now = () => new Date("2026-01-15T12:00:00Z");

describe("record", () => {
  it("requests the expected sequence with rounded coords and headers", async () => {
    const t = setup(happyRoutes());
    const res = await record({
      points: [point],
      outDir: "out",
      fetchFn: t.fetchFn,
      writeFile: t.writeFile,
      now,
      sleep: t.sleep,
      userAgent: buildUserAgent("me@example.com"),
    });
    expect(res.ok).toBe(true);
    expect(t.calls.map((c) => c.url)).toEqual([
      `${API}/points/39.7456,-97.0892`,
      `${API}/gridpoints/TOP/1,1/forecast`,
      `${API}/gridpoints/TOP/1,1/forecast/hourly`,
      `${API}/gridpoints/TOP/1,1/stations`,
      `${API}/stations/KAAA/observations/latest`,
      `${API}/stations/KBBB/observations/latest`,
      `${API}/alerts/active?point=39.7456,-97.0892`,
      `${API}/products/types/AFD/locations/TOP`,
      `${API}/products/afd-123`,
    ]);
    const headers = t.calls[0]?.init.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/geo+json");
    expect(headers["User-Agent"]).toMatch(/; me@example\.com$/);
    expect([...t.files.keys()]).toContain("out/obs_latest_linn-ks_KBBB.json");
    expect(t.files.get("out/points_linn-ks.json")?.endsWith("}\n")).toBe(true);
    expect(res.files).toContain("RECORDED.md");
  });

  it("omits contact from User-Agent when not provided", async () => {
    const t = setup(happyRoutes());
    await record({
      points: [point],
      outDir: "out",
      fetchFn: t.fetchFn,
      writeFile: t.writeFile,
      now,
      sleep: t.sleep,
      userAgent: buildUserAgent(),
    });
    const headers = t.calls[0]?.init.headers as Record<string, string>;
    expect(headers["User-Agent"]).not.toContain(";");
  });

  it("filters sidecar headers to the whitelist", async () => {
    const t = setup(happyRoutes());
    await record({
      points: [point],
      outDir: "out",
      fetchFn: t.fetchFn,
      writeFile: t.writeFile,
      now,
      sleep: t.sleep,
    });
    const sidecar = JSON.parse(
      t.files.get("out/points_linn-ks.headers.json") ?? "",
    );
    expect(sidecar.status).toBe(200);
    expect(sidecar.url).toBe(`${API}/points/39.7456,-97.0892`);
    expect(Object.keys(sidecar.headers).sort()).toEqual([
      "access-control-allow-origin",
      "cache-control",
      "content-type",
    ]);
  });

  it("retries a 503 then succeeds", async () => {
    const routes = happyRoutes();
    const url = `${API}/points/39.7456,-97.0892`;
    const good = routes[url] as Route;
    const t = setup({ ...routes, [url]: [{ status: 503, body: {} }, good] });
    const res = await record({
      points: [point],
      outDir: "out",
      fetchFn: t.fetchFn,
      writeFile: t.writeFile,
      now,
      sleep: t.sleep,
    });
    expect(res.ok).toBe(true);
    expect(t.calls.filter((c) => c.url === url)).toHaveLength(2);
    expect(t.sleeps).toEqual([1000]);
  });

  it("reports failure when alerts keep failing, but continues", async () => {
    const t = setup({
      ...happyRoutes(),
      [`${API}/alerts/active?point=39.7456,-97.0892`]: {
        status: 503,
        body: { title: "down" },
      },
    });
    const res = await record({
      points: [point],
      outDir: "out",
      fetchFn: t.fetchFn,
      writeFile: t.writeFile,
      now,
      sleep: t.sleep,
    });
    expect(res.ok).toBe(false);
    expect(res.coreFailures).toEqual(["alerts_active_linn-ks"]);
    expect(t.sleeps).toEqual([1000, 2000]);
    expect(
      JSON.parse(t.files.get("out/alerts_active_linn-ks.headers.json") ?? "")
        .status,
    ).toBe(503);
    expect(t.files.has("out/afd_product_linn-ks.json")).toBe(true);
  });

  it("a failed non-core resource does not fail the run", async () => {
    const t = setup({
      ...happyRoutes(),
      [`${API}/products/afd-123`]: { status: 404, body: {} },
    });
    const res = await record({
      points: [point],
      outDir: "out",
      fetchFn: t.fetchFn,
      writeFile: t.writeFile,
      now,
      sleep: t.sleep,
    });
    expect(res.ok).toBe(true);
    expect(res.failures).toEqual(["afd_product_linn-ks"]);
  });

  it("writes findings with ACAO, cache-control and AFD id to RECORDED.md", async () => {
    const t = setup(happyRoutes());
    await record({
      points: [point],
      outDir: "out",
      fetchFn: t.fetchFn,
      writeFile: t.writeFile,
      now,
      sleep: t.sleep,
    });
    const md = t.files.get("out/RECORDED.md") ?? "";
    expect(md).toContain("2026-01-15T12:00:00.000Z");
    expect(md).toContain("linn-ks: 39.7456,-97.0892");
    expect(md).toContain(
      "access-control-allow-origin` present on the points response: `*`",
    );
    expect(md).toContain("forecast: `public, max-age=3600`");
    expect(md).toContain("`afd-123`");
  });
});
