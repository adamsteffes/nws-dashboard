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
    expect(parseRoute("#/l/linn-ks/afd?p=abc-123")).toEqual({
      name: "discussion",
      id: "linn-ks",
      productId: "abc-123",
    });
    expect(parseRoute("#/manage")).toEqual({ name: "manage" });
  });

  it("decodes percent-encoded ids and product ids", () => {
    expect(parseRoute("#/l/%6Cinn")).toEqual({ name: "location", id: "linn" });
    expect(parseRoute("#/l/a/afd?p=x%2Fy")).toEqual({
      name: "discussion",
      id: "a",
      productId: "x/y",
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
    { name: "discussion", id: "linn-ks", productId: "x/y z" },
    { name: "manage" },
    { name: "notFound", hash: "#/nope" },
  ];

  it.each(routes)("round-trips %o", (route) => {
    expect(parseRoute(routeHref(route))).toEqual(route);
  });

  it("encodes product ids", () => {
    expect(routeHref({ name: "discussion", id: "a", productId: "x/y" })).toBe(
      "#/l/a/afd?p=x%2Fy",
    );
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
});
