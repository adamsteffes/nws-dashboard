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
    expect(() => afdListUrl("TOPE")).toThrow(RangeError);
    expect(() => afdListUrl("T-P")).toThrow(RangeError);
    expect(() => afdListUrl("")).toThrow(RangeError);
  });

  it("encodes product ids", () => {
    expect(productUrl("a/b c")).toBe(
      "https://api.weather.gov/products/a%2Fb%20c",
    );
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
});

describe("splitSections", () => {
  const text = parseProduct(fixture("afd_product_linn-ks")).text;

  it("splits the recorded Linn text into titled sections", () => {
    const sections = splitSections(text);
    expect(sections.length).toBeGreaterThan(2);
    expect(
      sections.filter((s) => s.title !== null).length,
    ).toBeGreaterThanOrEqual(2);
    expect(sections.some((s) => s.title === "DISCUSSION")).toBe(true);
  });

  it("keeps all non-separator text", () => {
    const joined = splitSections(text)
      .map((s) => s.body)
      .join("\n");
    const expected = text
      .split("\n")
      .filter(
        (l) => l.trim() !== "" && l !== "&&" && !/^\.[A-Z].*\.\.\.$/.test(l),
      );
    for (const line of expected) expect(joined).toContain(line);
  });

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
