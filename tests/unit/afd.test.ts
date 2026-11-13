import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  afdListUrl,
  fetchLatestAfd,
  parseProduct,
  parseProductList,
  productUrl,
  splitSections,
} from "../../src/nws/afd";
import { createNwsClient } from "../../src/nws/client";
import { NwsNotFound } from "../../src/nws/errors";
import { createFakeFetch, type Routes } from "../helpers/fakeFetch";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "fixtures", "nws", `${name}.json`),
      "utf-8",
    ),
  );

const SITES = ["linn-ks", "miami-fl"] as const;

function makeClient(routes: Routes) {
  const fetchFn = createFakeFetch(routes);
  const client = createNwsClient({
    fetchFn,
    isOnline: () => true,
    lastGood: {
      get: async () => undefined,
      put: async () => {},
      prune: async () => {},
      deleteByPrefix: async () => {},
      clear: async () => {},
    },
  });
  return { client, fetchFn };
}

describe("parseProductList", () => {
  for (const site of SITES) {
    it(`parses the recorded ${site} list newest first`, () => {
      const json = fixture(`afd_list_${site}`);
      const refs = parseProductList(json);
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.length).toBeLessThanOrEqual(6);
      for (const ref of refs) {
        expect(ref.id).not.toBe("");
        expect(ref.issuanceTime).not.toBe("");
      }
      const times = refs.map((r) => Date.parse(r.issuanceTime));
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(parseProductList(json, 2)).toHaveLength(2);
    });
  }

  it("sorts a shuffled list", () => {
    const graph = [
      { id: "b", issuanceTime: "2026-11-12T10:00:00+00:00" },
      { id: "c", issuanceTime: "2026-11-13T10:00:00+00:00" },
      { id: "a", issuanceTime: "2026-11-11T10:00:00+00:00" },
    ];
    const ids = parseProductList({ "@graph": graph }).map((r) => r.id);
    expect(ids).toEqual(["c", "b", "a"]);
  });

  it("skips entries missing id or issuanceTime", () => {
    const refs = parseProductList({
      "@graph": [
        { issuanceTime: "2026-11-13T10:00:00+00:00" },
        { id: "x" },
        { id: "ok", issuanceTime: "2026-11-13T10:00:00+00:00" },
      ],
    });
    expect(refs.map((r) => r.id)).toEqual(["ok"]);
  });

  it("returns [] for an empty or missing graph", () => {
    expect(parseProductList({ "@graph": [] })).toEqual([]);
    expect(parseProductList({})).toEqual([]);
    expect(parseProductList(null)).toEqual([]);
  });
});

describe("parseProduct", () => {
  for (const site of SITES) {
    it(`parses the recorded ${site} product`, () => {
      const product = parseProduct(fixture(`afd_product_${site}`));
      expect(product.id).not.toBe("");
      expect(product.text).toMatch(/^(000|FXUS)/);
      expect(product.text).not.toContain("\r");
      expect(product.text).not.toMatch(/[ \t]$/m);
      expect(product.text).toBe(product.text.trim());
    });
  }

  it("normalizes line endings and whitespace", () => {
    const product = parseProduct({
      id: "p",
      productText: "\r\n\r\nLine one  \r\nLine two\t\r\n\r\n",
    });
    expect(product.text).toBe("Line one\nLine two");
  });

  it("throws when id or productText is missing", () => {
    expect(() => parseProduct({ id: "p" })).toThrow(/productText/);
    expect(() => parseProduct({ productText: "x" })).toThrow(/id/);
  });
});

describe("URL builders", () => {
  it("builds and validates the list URL", () => {
    expect(afdListUrl(" top ")).toBe(
      "https://api.weather.gov/products/types/AFD/locations/TOP",
    );
    expect(() => afdListUrl("TOPEK")).toThrow(RangeError);
    expect(() => afdListUrl("T-P")).toThrow(RangeError);
    expect(() => afdListUrl("")).toThrow(RangeError);
  });

  it("strips the leading letter of a 4-character ICAO id", () => {
    const top = "https://api.weather.gov/products/types/AFD/locations/TOP";
    expect(afdListUrl("ktop")).toBe(top);
    expect(afdListUrl("PHFO")).toMatch(/\/HFO$/);
    expect(afdListUrl("TJSJ")).toMatch(/\/JSJ$/);
    expect(() => afdListUrl("XTOP")).toThrow(RangeError);
  });

  it("encodes product ids", () => {
    expect(productUrl("a b")).toBe("https://api.weather.gov/products/a%20b");
  });

  it("rejects ids that could change the path", () => {
    for (const id of ["", ".", "..", "a/b", "../x"]) {
      expect(() => productUrl(id)).toThrow(RangeError);
    }
  });
});

describe("issuanceTime handling", () => {
  it("drops entries whose time does not parse", () => {
    const refs = parseProductList({
      "@graph": [
        { id: "bad", issuanceTime: "not a time" },
        { id: "ok", issuanceTime: "2026-11-13T10:00:00+00:00" },
      ],
    });
    expect(refs.map((r) => r.id)).toEqual(["ok"]);
  });

  it("reads a time without an offset as UTC", () => {
    const refs = parseProductList({
      "@graph": [
        // 10:00 at -05:00 is 15:00Z, later than a bare 12:00 read as UTC.
        { id: "offset", issuanceTime: "2026-11-13T10:00:00-05:00" },
        { id: "bare", issuanceTime: "2026-11-13T12:00:00" },
        { id: "bare-late", issuanceTime: "2026-11-13T16:00:00" },
      ],
    });
    expect(refs.map((r) => r.id)).toEqual(["bare-late", "offset", "bare"]);
  });

  it("normalizes the limit", () => {
    const graph = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      issuanceTime: `2026-11-1${i}T00:00:00Z`,
    }));
    const count = (limit: number) =>
      parseProductList({ "@graph": graph }, limit).length;
    expect(count(0)).toBe(0);
    expect(count(-3)).toBe(0);
    expect(count(2.9)).toBe(2);
    expect(count(Number.NaN)).toBe(6);
    expect(count(Number.POSITIVE_INFINITY)).toBe(6);
  });
});

describe("fetchLatestAfd", () => {
  it("fetches the list, then the newest product", async () => {
    const newest = parseProductList(fixture("afd_list_linn-ks"))[0];
    if (!newest) throw new Error("fixture list is empty");
    const listUrl = afdListUrl("TOP");
    const prodUrl = productUrl(newest.id);
    const { client, fetchFn } = makeClient({
      [listUrl]: "afd_list_linn-ks",
      [prodUrl]: "afd_product_linn-ks",
    });
    const res = await fetchLatestAfd(client, "top");
    expect(fetchFn.calls.map((c) => c.url)).toEqual([listUrl, prodUrl]);
    expect(res.list.data[0]?.id).toBe(newest.id);
    expect(res.latest?.data.text).toMatch(/^000/);
  });

  it("returns latest null without a product request for an empty list", async () => {
    const listUrl = afdListUrl("TOP");
    const { client, fetchFn } = makeClient({
      [listUrl]: { status: 200, body: { "@graph": [] } },
    });
    const res = await fetchLatestAfd(client, "TOP");
    expect(res.latest).toBeNull();
    expect(res.list.data).toEqual([]);
    expect(fetchFn.calls.map((c) => c.url)).toEqual([listUrl]);
  });

  it("still returns the newest product when limit is 0, negative or NaN", async () => {
    const newest = parseProductList(fixture("afd_list_linn-ks"))[0];
    if (!newest) throw new Error("fixture list is empty");
    for (const limit of [0, -1, Number.NaN, 1.5]) {
      const { client } = makeClient({
        [afdListUrl("TOP")]: "afd_list_linn-ks",
        [productUrl(newest.id)]: "afd_product_linn-ks",
      });
      const res = await fetchLatestAfd(client, "TOP", { limit });
      expect(res.latest?.data.id).toBeDefined();
      expect(res.list.data.length).toBe(
        Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 6,
      );
    }
  });

  it("passes refresh through to every request", async () => {
    const newest = parseProductList(fixture("afd_list_linn-ks"))[0];
    if (!newest) throw new Error("fixture list is empty");
    const { client, fetchFn } = makeClient({
      [afdListUrl("TOP")]: "afd_list_linn-ks",
      [productUrl(newest.id)]: "afd_product_linn-ks",
    });
    await fetchLatestAfd(client, "TOP", { refresh: true });
    expect(fetchFn.calls).toHaveLength(2);
    expect(fetchFn.calls.map((c) => c.init?.cache)).toEqual([
      "no-cache",
      "no-cache",
    ]);
  });

  const threeEntries = {
    "@graph": [
      { id: "new", issuanceTime: "2026-11-13T10:00:00Z" },
      { id: "mid", issuanceTime: "2026-11-13T04:00:00Z" },
      { id: "old", issuanceTime: "2026-11-12T22:00:00Z" },
      { id: "older", issuanceTime: "2026-11-12T16:00:00Z" },
    ],
  };

  it("falls back to the next id when the newest product fails", async () => {
    const { client, fetchFn } = makeClient({
      [afdListUrl("TOP")]: { status: 200, body: threeEntries },
      [productUrl("new")]: 404,
      [productUrl("mid")]: "afd_product_linn-ks",
    });
    const res = await fetchLatestAfd(client, "TOP");
    expect(res.error).toBeUndefined();
    expect(res.latest?.data.text).toMatch(/^000/);
    expect(fetchFn.calls.map((c) => c.url)).toEqual([
      afdListUrl("TOP"),
      productUrl("new"),
      productUrl("mid"),
    ]);
  });

  it("keeps the list and reports the error when every attempt fails", async () => {
    const { client, fetchFn } = makeClient({
      [afdListUrl("TOP")]: { status: 200, body: threeEntries },
      [productUrl("new")]: 404,
      [productUrl("mid")]: 404,
      [productUrl("old")]: 404,
    });
    const res = await fetchLatestAfd(client, "TOP");
    expect(res.latest).toBeNull();
    expect(res.error).toBeInstanceOf(NwsNotFound);
    expect(res.list.data.map((r) => r.id)).toEqual([
      "new",
      "mid",
      "old",
      "older",
    ]);
    // Three product attempts at most; "older" is never requested.
    expect(fetchFn.calls).toHaveLength(4);
  });

  it("rejects when the list fetch itself fails", async () => {
    const { client } = makeClient({ [afdListUrl("TOP")]: 404 });
    await expect(fetchLatestAfd(client, "TOP")).rejects.toBeInstanceOf(
      NwsNotFound,
    );
  });
});

describe("splitSections", () => {
  const text = parseProduct(fixture("afd_product_linn-ks")).text;

  const titles = (t: string) =>
    splitSections(t)
      .map((s) => s.title)
      .filter((title) => title !== null);

  it("finds the exact titles in the recorded Linn text", () => {
    expect(titles(text)).toEqual([
      "KEY MESSAGES",
      "DISCUSSION",
      "AVIATION /06Z TAFS THROUGH 06Z SATURDAY/",
      "TOP WATCHES/WARNINGS/ADVISORIES",
    ]);
  });

  it("finds the exact titles in the recorded Miami text", () => {
    const miami = parseProduct(fixture("afd_product_miami-fl")).text;
    expect(titles(miami)).toEqual([
      "KEY MESSAGES",
      "SHORT TERM",
      "LONG TERM",
      "AVIATION",
      "MARINE",
      "PRELIMINARY POINT TEMPS/POPS",
      "MFL WATCHES/WARNINGS/ADVISORIES",
    ]);
  });

  // Separators are compared out: `&&` only ends a section, so rebuilding adds
  // them back after every section.
  for (const site of SITES) {
    it(`loses no text rebuilding the ${site} product from its sections`, () => {
      const original = parseProduct(fixture(`afd_product_${site}`)).text;
      const rebuilt = splitSections(original)
        .map((s) =>
          [s.title === null ? "" : `.${s.title}...`, s.body, "&&"].join("\n"),
        )
        .join("\n");
      const lines = (t: string) =>
        t
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l !== "" && l !== "&&");
      expect(lines(rebuilt)).toEqual(lines(original));
    });
  }

  it("handles titles with slashes and untitled preamble", () => {
    const sections = splitSections(
      "preamble\n\n.SHORT TERM /Tonight through Saturday/...\nbody\n&&\ntail",
    );
    expect(sections).toEqual([
      { title: null, body: "preamble" },
      { title: "SHORT TERM /Tonight through Saturday/", body: "body" },
      { title: null, body: "tail" },
    ]);
  });
});
