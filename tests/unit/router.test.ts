import { describe, expect, it, vi } from "vitest";
import {
  createRouter,
  parseRoute,
  type Route,
  routeHref,
} from "../../src/router";

describe("parseRoute", () => {
  it("parses the dashboard", () => {
    expect(parseRoute("")).toEqual({ name: "dashboard" });
    expect(parseRoute("#")).toEqual({ name: "dashboard" });
    expect(parseRoute("#/")).toEqual({ name: "dashboard" });
  });

  it("parses location, discussion and manage routes", () => {
    expect(parseRoute("#/l/linn-ks")).toEqual({
      name: "location",
      id: "linn-ks",
    });
    expect(parseRoute("#/l/linn-ks/afd")).toEqual({
      name: "discussion",
      id: "linn-ks",
    });
    expect(
      parseRoute("#/l/linn-ks/afd?p=0b1f3c2e-7a4d-4c1e-9a52-3f6d8e2b7c10"),
    ).toEqual({
      name: "discussion",
      id: "linn-ks",
      productId: "0b1f3c2e-7a4d-4c1e-9a52-3f6d8e2b7c10",
    });
    expect(parseRoute("#/manage")).toEqual({ name: "manage" });
  });

  it("decodes percent-encoded ids and product ids", () => {
    expect(parseRoute("#/l/%6Cinn")).toEqual({ name: "location", id: "linn" });
    expect(
      parseRoute("#/l/a/afd?p=0b1f3c2e%2D7a4d-4c1e-9a52-3f6d8e2b7c10"),
    ).toEqual({
      name: "discussion",
      id: "a",
      productId: "0b1f3c2e-7a4d-4c1e-9a52-3f6d8e2b7c10",
    });
  });

  it.each([
    "#/l/UPPER",
    "#/l/has_underscore",
    "#/l/a%20b",
    "#/l/%E0%A4%A",
    `#/l/${"a".repeat(61)}`,
    "#/l/",
    "#/l/a/b",
    "#/l/a/afd/extra",
    "#/nope",
    "#/manage/x",
  ])("returns notFound for %s", (hash) => {
    expect(parseRoute(hash)).toEqual({ name: "notFound", hash });
  });

  it("rejects product ids that are not UUIDs", () => {
    for (const p of [
      "abc-123",
      "x%2Fy",
      "0b1f3c2e-7a4d-4c1e-9a52-3f6d8e2b7c1",
    ]) {
      const hash = `#/l/a/afd?p=${p}`;
      expect(parseRoute(hash)).toEqual({ name: "notFound", hash });
    }
  });

  it("ignores an empty product id", () => {
    expect(parseRoute("#/l/a/afd?p=")).toEqual({ name: "discussion", id: "a" });
  });

  it("tolerates a single trailing slash", () => {
    expect(parseRoute("#/manage/")).toEqual({ name: "manage" });
    expect(parseRoute("#/l/a/")).toEqual({ name: "location", id: "a" });
    expect(parseRoute("#/l/a/afd/")).toEqual({ name: "discussion", id: "a" });
    expect(parseRoute("#/manage//")).toEqual({
      name: "notFound",
      hash: "#/manage//",
    });
  });

  it("ignores the query on non-discussion routes", () => {
    expect(parseRoute("#/manage?x=1")).toEqual({ name: "manage" });
    expect(parseRoute("#/l/a?p=zzz")).toEqual({ name: "location", id: "a" });
  });

  it("accepts a 60 character id", () => {
    const id = "a".repeat(60);
    expect(parseRoute(`#/l/${id}`)).toEqual({ name: "location", id });
  });
});

describe("routeHref", () => {
  const routes: Route[] = [
    { name: "dashboard" },
    { name: "location", id: "linn-ks" },
    { name: "discussion", id: "linn-ks" },
    {
      name: "discussion",
      id: "linn-ks",
      productId: "0b1f3c2e-7a4d-4c1e-9a52-3f6d8e2b7c10",
    },
    { name: "manage" },
    { name: "notFound", hash: "#/nope" },
  ];

  it.each(routes)("round-trips %o", (route) => {
    expect(parseRoute(routeHref(route))).toEqual(route);
  });

  it("builds the product id query", () => {
    expect(
      routeHref({
        name: "discussion",
        id: "a",
        productId: "0b1f3c2e-7a4d-4c1e-9a52-3f6d8e2b7c10",
      }),
    ).toBe("#/l/a/afd?p=0b1f3c2e-7a4d-4c1e-9a52-3f6d8e2b7c10");
  });
});

describe("createRouter", () => {
  it("notifies on hashchange until stopped", () => {
    const onChange = vi.fn();
    const stop = createRouter(onChange);
    window.location.hash = "#/manage";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(onChange).toHaveBeenLastCalledWith({ name: "manage" });
    const calls = onChange.mock.calls.length;
    stop();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(onChange).toHaveBeenCalledTimes(calls);
  });

  it("ignores non-route hashes such as #main", () => {
    const onChange = vi.fn();
    const stop = createRouter(onChange);
    window.location.hash = "#main";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(onChange).not.toHaveBeenCalled();
    window.location.hash = "";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(onChange).toHaveBeenCalledWith({ name: "dashboard" });
    stop();
  });
});
