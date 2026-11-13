import { render } from "lit-html";
import { describe, expect, it } from "vitest";
import { homeView } from "../../src/views/home";

describe("homeView", () => {
  it("renders the heading and version", () => {
    const el = document.createElement("div");
    render(homeView("1.2.3"), el);
    expect(el.querySelector("h1")?.textContent).toBe("NWS Weather");
    expect(el.textContent).toContain("1.2.3");
    expect(el.textContent).toContain("Dashboard coming soon");
  });
});
