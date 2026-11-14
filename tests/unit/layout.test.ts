import { html, render } from "lit-html";
import { describe, expect, it, vi } from "vitest";
import { type LayoutProps, layoutView } from "../../src/views/layout";

function mount(overrides: Partial<LayoutProps> = {}) {
  const el = document.createElement("div");
  const props: LayoutProps = {
    route: { name: "dashboard" },
    title: "NWS Weather",
    online: true,
    refreshing: false,
    onRefresh: () => {},
    content: html`<p id="content">Hello</p>`,
    version: "1.2.3",
    ...overrides,
  };
  render(layoutView(props), el);
  return el;
}

function navLink(el: HTMLElement, name: string) {
  const link = [...el.querySelectorAll("nav a")].find(
    (a) => a.textContent?.trim() === name,
  );
  if (!link) throw new Error(`no nav link ${name}`);
  return link;
}

describe("layoutView", () => {
  it("renders landmarks, title, content and nav links", () => {
    const el = mount();
    expect(el.querySelector("header h1")?.textContent).toBe("NWS Weather");
    expect(el.querySelector("main #content")?.textContent).toBe("Hello");
    expect(el.querySelector("footer")).not.toBeNull();
    expect(el.querySelector(".skip-link")?.getAttribute("href")).toBe("#main");
    expect(navLink(el, "Dashboard").getAttribute("href")).toBe("#/");
    expect(navLink(el, "Locations").getAttribute("href")).toBe("#/manage");
  });

  it("marks the active nav link with aria-current", () => {
    let el = mount();
    expect(navLink(el, "Dashboard").getAttribute("aria-current")).toBe("page");
    expect(navLink(el, "Locations").hasAttribute("aria-current")).toBe(false);

    el = mount({ route: { name: "manage" } });
    expect(navLink(el, "Dashboard").hasAttribute("aria-current")).toBe(false);
    expect(navLink(el, "Locations").getAttribute("aria-current")).toBe("page");
  });

  it("enables Refresh and calls onRefresh", () => {
    const onRefresh = vi.fn();
    const el = mount({ onRefresh });
    const button = el.querySelector("button") as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe("Refresh");
    expect(button.disabled).toBe(false);
    button.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables Refresh while refreshing", () => {
    const el = mount({ refreshing: true });
    const button = el.querySelector("button") as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe("Refreshing…");
    expect(button.disabled).toBe(true);
  });

  it("shows the offline banner only when offline", () => {
    expect(mount().querySelector(".banner")).toBeNull();
    const el = mount({ online: false });
    expect(el.querySelector(".banner")?.textContent).toBe(
      "You're offline — showing saved data",
    );
  });

  it("shows the version and NWS attribution in the footer", () => {
    const footer = mount().querySelector("footer") as HTMLElement;
    expect(footer.textContent).toContain("1.2.3");
    expect(footer.querySelector("a")?.getAttribute("href")).toBe(
      "https://www.weather.gov/",
    );
  });

  it("escapes the title", () => {
    const el = mount({ title: "<img src=x onerror=alert(1)>" });
    expect(el.querySelector("header img")).toBeNull();
    expect(el.querySelector("h1")?.textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });
});
