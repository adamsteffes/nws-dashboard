import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "lit-html";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscussionViewProps } from "../../src/app/discussionController";
import {
  type Product,
  type ProductRef,
  parseProduct,
  parseProductList,
} from "../../src/nws/afd";
import { routeHref } from "../../src/router";
import type { SavedLocation } from "../../src/store/locations";
import { discussionView } from "../../src/views/discussion";
import { linnMeta, NOW } from "../helpers/dashboardSetup";

const readFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "fixtures", "nws", `${name}.json`),
      "utf-8",
    ),
  );

const refs: ProductRef[] = parseProductList(readFixture("afd_list_linn-ks"));
const product: Product = parseProduct(readFixture("afd_product_linn-ks"));

const location: SavedLocation = {
  id: "linn",
  name: "Linn",
  lat: 39.7456,
  lon: -97.0892,
  createdAt: NOW.toISOString(),
  nws: linnMeta(),
};

const props = (
  over: Partial<DiscussionViewProps> = {},
): DiscussionViewProps => ({
  location,
  list: { status: "ok", data: refs, fetchedAt: NOW.toISOString() },
  product: { status: "ok", data: product, fetchedAt: NOW.toISOString() },
  sections: false,
  now: NOW,
  ...over,
});

function draw(
  p: DiscussionViewProps,
  onSections: (on: boolean) => void = () => {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  render(discussionView(p, { onSections }), host);
  return host;
}

describe("discussionView", () => {
  // Section ids repeat across renders; stale hosts would answer getElementById.
  afterEach(() => document.body.replaceChildren());

  it("shows the heading, office, local issuance time and location name", () => {
    const host = draw(props());
    expect(host.querySelector("h2")?.textContent).toBe("Forecast discussion");
    const sub = host.querySelector("p.muted")?.textContent ?? "";
    // 04:36Z is 10:36 PM the evening before in Kansas (CST).
    expect(sub).toContain("KTOP — issued Nov 12, 10:36 PM CST");
    expect(sub).toContain("for Linn");
  });

  it("renders the text in a pre with the text as is", () => {
    const host = draw(props());
    const pre = host.querySelector("pre.afd-text");
    expect(pre?.textContent).toBe(product.text);
    expect(host.querySelectorAll("pre")).toHaveLength(1);
    expect(host.querySelector("h3.afd-section")).toBeNull();
  });

  it("never turns product text into markup", () => {
    const evil = `<script>window.__pwned = 1</script><img src=x onerror="alert(1)">`;
    const host = draw(
      props({
        product: { status: "ok", data: { ...product, text: evil } },
      }),
    );
    expect(host.querySelector("pre")?.textContent).toBe(evil);
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("pre img")).toBeNull();
  });

  it("escapes section titles and bodies in the sections view", () => {
    const text = `.<B>EVIL...\n<script>x</script>\n&&`;
    const host = draw(
      props({
        sections: true,
        product: {
          status: "ok",
          data: { ...product, text: `.EVIL <I>...\n${text}` },
        },
      }),
    );
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("h3 i, h3 b")).toBeNull();
  });

  it("toggles to sections and reports the request", () => {
    const onSections = vi.fn();
    const host = draw(props(), onSections);
    const toggle = host.querySelector<HTMLButtonElement>(".afd-toggle");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    toggle?.click();
    expect(onSections).toHaveBeenCalledWith(true);
  });

  it("builds a table of contents from the recorded section titles", () => {
    const onSections = vi.fn();
    const host = draw(props({ sections: true }), onSections);
    expect(
      host.querySelector(".afd-toggle")?.getAttribute("aria-pressed"),
    ).toBe("true");
    host.querySelector<HTMLButtonElement>(".afd-toggle")?.click();
    expect(onSections).toHaveBeenCalledWith(false);

    const links = [...host.querySelectorAll<HTMLAnchorElement>(".afd-toc a")];
    expect(links.map((a) => a.textContent)).toEqual([
      "KEY MESSAGES",
      "DISCUSSION",
      "AVIATION /06Z TAFS THROUGH 06Z SATURDAY/",
      "TOP WATCHES/WARNINGS/ADVISORIES",
    ]);
    // Each entry scrolls to the section with the same title.
    const titles = [...host.querySelectorAll("section.afd-section h3")].map(
      (h) => h.textContent,
    );
    expect(titles).toEqual(links.map((a) => a.textContent));
    const headings = [...host.querySelectorAll("section.afd-section h3")];
    expect(headings.map((h) => h.textContent)).toContain("DISCUSSION");
    expect(host.querySelector(".afd-section pre")).not.toBeNull();
  });

  it("jumps to a section without following the link", () => {
    window.location.hash = "#/l/linn/afd";
    const host = draw(props({ sections: true }));
    const scroll = vi.fn();
    for (const section of host.querySelectorAll("section.afd-section")) {
      (section as HTMLElement).scrollIntoView = scroll;
    }
    const link = host.querySelectorAll<HTMLAnchorElement>(".afd-toc a")[1];
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/l/linn/afd");
  });

  it("links previous discussions with valid product ids and marks the current one", () => {
    const host = draw(props());
    const links = [
      ...host.querySelectorAll<HTMLAnchorElement>(".afd-history a"),
    ];
    // The list is capped at six; the shown (newest) one is not a link.
    expect(links).toHaveLength(refs.length - 1);
    expect(links[0]?.getAttribute("href")).toBe(
      routeHref({ name: "discussion", id: "linn", productId: refs[1]?.id }),
    );
    for (const a of links) {
      expect(a.getAttribute("href")).toMatch(
        /^#\/l\/linn\/afd\?p=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
    expect(links[0]?.textContent?.trim()).toBe("Nov 12, 4:34 PM CST");
    const current = host.querySelector(".afd-current");
    expect(current?.getAttribute("aria-current")).toBe("true");
    expect(current?.textContent).toContain("Nov 12, 10:36 PM CST");
  });

  it("marks an older product as current when it is the one shown", () => {
    const older = refs[2] as ProductRef;
    const host = draw(
      props({
        productId: older.id,
        product: { status: "ok", data: { ...product, id: older.id } },
      }),
    );
    expect(host.querySelectorAll(".afd-current")).toHaveLength(1);
    const hrefs = [...host.querySelectorAll(".afd-history a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain(
      routeHref({ name: "discussion", id: "linn", productId: refs[0]?.id }),
    );
    expect(hrefs).not.toContain(
      routeHref({ name: "discussion", id: "linn", productId: older.id }),
    );
  });

  it("keeps the page's own route in the table of contents links", () => {
    const host = draw(props({ sections: true }));
    for (const a of host.querySelectorAll(".afd-toc a")) {
      expect(a.getAttribute("href")).toBe("#/l/linn/afd");
    }
    const older = refs[1] as ProductRef;
    const other = draw(props({ sections: true, productId: older.id }));
    expect(other.querySelector(".afd-toc a")?.getAttribute("href")).toBe(
      routeHref({ name: "discussion", id: "linn", productId: older.id }),
    );
  });

  it("marks the requested issuance as showing even if its product failed", () => {
    const requested = refs[2] as ProductRef;
    const host = draw(
      props({
        productId: requested.id,
        product: { status: "error", error: "Weather Service unavailable" },
      }),
    );
    expect(host.querySelectorAll(".afd-current")).toHaveLength(1);
    expect(host.querySelector(".afd-current")?.textContent).toContain(
      "(showing)",
    );
  });

  it("links back to the location", () => {
    const host = draw(props());
    expect(host.querySelector(".back-link")?.getAttribute("href")).toBe(
      "#/l/linn",
    );
  });

  it("says when no discussion is available", () => {
    const host = draw(
      props({
        list: { status: "ok", data: [] },
        product: { status: "ok" },
      }),
    );
    expect(host.textContent).toContain("No discussion available");
    expect(host.querySelector("pre")).toBeNull();
    expect(host.querySelector(".afd-history")).toBeNull();
  });

  it("explains that the discussion could not be loaded", () => {
    const host = draw(
      props({
        list: { status: "error", error: "Weather Service unavailable" },
        product: { status: "error", error: "Weather Service unavailable" },
      }),
    );
    expect(host.textContent).toContain("The discussion couldn't be loaded");
    expect(host.textContent).toContain(
      "Previous discussions: Weather Service unavailable",
    );
    expect(host.querySelector("pre")).toBeNull();
  });

  it("shows loading notes", () => {
    const host = draw(
      props({ list: { status: "loading" }, product: { status: "loading" } }),
    );
    expect(host.textContent).toContain("Discussion: Loading…");
    expect(host.textContent).toContain("Previous discussions: Loading…");
  });

  it("notes saved data when stale", () => {
    const host = draw(
      props({
        product: {
          status: "stale",
          data: product,
          fetchedAt: "2026-11-13T05:00:00Z",
        },
      }),
    );
    expect(host.textContent).toContain(
      "Showing saved data from Nov 12, 11:00 PM CST",
    );
    expect(host.querySelector("pre")?.textContent).toBe(product.text);
  });

  it("says when an older discussion is shown because the newest failed", () => {
    const older = refs[1] as ProductRef;
    const host = draw(
      props({ product: { status: "ok", data: { ...product, id: older.id } } }),
    );
    expect(host.textContent).toContain("older one");
  });

  it("shows not found for an unknown location", () => {
    const host = draw(props({ location: undefined }));
    expect(host.textContent).toContain("Location not found");
    expect(host.querySelector("pre")).toBeNull();
  });
});
