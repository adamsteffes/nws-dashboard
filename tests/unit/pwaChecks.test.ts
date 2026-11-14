import { describe, expect, it } from "vitest";
import {
  distPathForIcon,
  serviceWorkerProblems,
} from "../../scripts/pwa-checks";

const BASE = "/nws-dashboard/";
const GOOD_SW = `precacheAndRoute([{url:"index.html",revision:"a"},{url:"icon.svg",revision:"b"}]);
e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("/nws-dashboard/index.html")))`;

describe("serviceWorkerProblems", () => {
  it("accepts a shell-only worker", () => {
    expect(serviceWorkerProblems(GOOD_SW, BASE)).toEqual([]);
  });

  it("requires index.html in the precache manifest", () => {
    const sw = GOOD_SW.replace('{url:"index.html"', '{url:"other.html"');
    expect(serviceWorkerProblems(sw, BASE)).toContain(
      "index.html is not in the precache manifest",
    );
  });

  it("requires the navigation fallback bound to the base", () => {
    const sw = GOOD_SW.replace("/nws-dashboard/index.html", "/index.html");
    expect(serviceWorkerProblems(sw, BASE)).toHaveLength(1);
  });

  it.each([
    "NetworkFirst",
    "CacheFirst",
    "StaleWhileRevalidate",
    "NetworkOnly",
  ])("rejects runtime strategy %s", (name) => {
    const sw = `${GOOD_SW};new e.${name}({})`;
    expect(serviceWorkerProblems(sw, BASE).join()).toContain(name);
  });

  it("rejects extra routes and external hosts", () => {
    const sw = `${GOOD_SW};e.registerRoute(/x/,h);fetch("https://api.weather.gov")`;
    const problems = serviceWorkerProblems(sw, BASE).join();
    expect(problems).toContain("registers 2 routes");
    expect(problems).toContain("api.weather.gov");
  });
});

describe("distPathForIcon", () => {
  it("handles relative, root-relative and base-absolute sources", () => {
    expect(distPathForIcon("pwa-192x192.png", BASE)).toBe("pwa-192x192.png");
    expect(distPathForIcon("./pwa-192x192.png", BASE)).toBe("pwa-192x192.png");
    expect(distPathForIcon("/nws-dashboard/pwa-192x192.png", BASE)).toBe(
      "pwa-192x192.png",
    );
  });
});
