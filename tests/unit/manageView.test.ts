import { render } from "lit-html";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppContext, type GeolocationLike } from "../../src/app/context";
import { createManageController } from "../../src/app/manageController";
import { createNwsClient } from "../../src/nws/client";
import { createLocationStore, DEFAULT_KEY } from "../../src/store/locations";
import { dashboardView } from "../../src/views/dashboard";
import { locationView } from "../../src/views/location";
import { manageView } from "../../src/views/manage";
import { createFakeFetch } from "../helpers/fakeFetch";
import {
  createMemoryStorage,
  type MemoryStorage,
} from "../helpers/memoryStorage";

const LINN = "https://api.weather.gov/points/39.7456,-97.0892";
const STATIONS = "https://api.weather.gov/gridpoints/TOP/32,81/stations";
const EVIL = "<img src=x onerror=alert(1)>";

function mount(
  options: { storage?: MemoryStorage; geolocation?: GeolocationLike } = {},
) {
  const store = createLocationStore({
    storage: options.storage ?? createMemoryStorage(),
  });
  const client = createNwsClient({
    fetchFn: createFakeFetch({
      [LINN]: "points_linn-ks",
      [STATIONS]: "stations_linn-ks",
    }),
    isOnline: () => true,
    sleep: async () => {},
    lastGood: {
      async get() {
        return undefined;
      },
      async put() {},
      async prune() {},
      async deleteByPrefix() {},
      async clear() {},
    },
  });
  const ctx = createAppContext({
    store,
    client,
    geolocation: options.geolocation,
  });
  const el = document.createElement("div");
  document.body.append(el);
  const ctrl = createManageController(ctx, {
    onChange: () => draw(),
    reload: vi.fn(),
  });
  const draw = () => render(manageView(ctrl.viewProps()), el);
  draw();
  store.subscribe(draw);
  return { el, store, ctrl, draw };
}

const buttons = (el: HTMLElement) => [...el.querySelectorAll("button")];
const button = (el: HTMLElement, label: string) =>
  buttons(el).find((b) => b.textContent?.trim().startsWith(label));
const mustButton = (el: HTMLElement, label: string) => {
  const found = button(el, label);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
};

function type(el: HTMLElement, selector: string, value: string) {
  const input = el.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`no ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("manageView", () => {
  it("renders names as text, never as HTML", () => {
    const { el, store } = mount();
    store.add({ name: EVIL, lat: 39, lon: -97 });
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector(".loc-link")?.textContent).toBe(EVIL);
    mustButton(el, "Delete").click();
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector(".confirm-row")?.textContent).toContain(
      `Delete ${EVIL}?`,
    );
  });

  it("lists city and state, or says it is not yet looked up", () => {
    const { el, store } = mount();
    store.add({ name: "Plain", lat: 39, lon: -97 });
    expect(el.querySelector(".loc-row")?.textContent).toContain(
      "Not yet looked up",
    );
    expect(el.querySelector(".loc-row")?.textContent).toContain("39, -97");
  });

  it("adds a location through the form and lists it", async () => {
    const { el, store } = mount();
    type(el, "#add-name", "Linn");
    type(el, "#add-lat", "39.7456");
    type(el, "#add-lon", "-97.0892");
    el.querySelector("form")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(store.list()).toHaveLength(1));
    await vi.waitFor(() =>
      expect(el.querySelector(".loc-row")?.textContent).toContain("Linn, KS"),
    );
    expect(el.querySelector("[role=status]")).not.toBeNull();
  });

  it("disables the submit button while busy", () => {
    const { el, ctrl } = mount();
    ctrl.state.add.busy = true;
    ctrl.actions.setAddField("name", "x");
    expect(mustButton(el, "Adding").disabled).toBe(true);
  });

  it("walks through delete confirmation", () => {
    const { el, store } = mount();
    store.add({ name: "Home", lat: 39, lon: -97 });
    mustButton(el, "Delete").click();
    expect(el.textContent).toContain("Delete Home?");
    mustButton(el, "Cancel").click();
    expect(store.list()).toHaveLength(1);
    mustButton(el, "Delete").click();
    mustButton(el, "Yes").click();
    expect(store.list()).toEqual([]);
  });

  it("renames inline", () => {
    const { el, store } = mount();
    store.add({ name: "Home", lat: 39, lon: -97 });
    mustButton(el, "Rename").click();
    type(el, "[id^=rename-]", "Cabin");
    mustButton(el, "Save").click();
    expect(store.list()[0]?.name).toBe("Cabin");
  });

  it("uses decimal keyboards and labelled inputs", () => {
    const { el } = mount();
    for (const id of ["add-lat", "add-lon"]) {
      expect(el.querySelector(`#${id}`)?.getAttribute("inputmode")).toBe(
        "decimal",
      );
      expect(el.querySelector(`label[for=${id}]`)).not.toBeNull();
    }
  });

  it("hides Use my location without geolocation", () => {
    expect(button(mount().el, "Use my location")).toBeUndefined();
    const { el } = mount({ geolocation: { getCurrentPosition: () => {} } });
    expect(button(el, "Use my location")).toBeDefined();
  });

  it("shows the exported JSON in a read-only textarea with Copy", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("URL", {});
    const { el, store } = mount();
    store.add({ name: "Home", lat: 39, lon: -97 });
    mustButton(el, "Export").click();
    await vi.waitFor(() =>
      expect(
        el.querySelector<HTMLTextAreaElement>("#export-text"),
      ).not.toBeNull(),
    );
    const area = el.querySelector<HTMLTextAreaElement>("#export-text");
    expect(area?.readOnly).toBe(true);
    expect(area?.value).toContain('"Home"');
    expect(button(el, "Copy")).toBeDefined();
    vi.unstubAllGlobals();
  });

  it("shows replace confirmation with Export first, then import counts", () => {
    const { el, store } = mount();
    store.add({ name: "Home", lat: 39, lon: -97 });
    const select = el.querySelector<HTMLSelectElement>("#import-mode");
    if (!select) throw new Error("no select");
    select.value = "replace";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    type(
      el,
      "#import-text",
      JSON.stringify({ locations: [{ name: "Cabin", lat: 30, lon: -90 }] }),
    );
    mustButton(el, "Import").click();
    expect(el.querySelector("[aria-label='Confirm replace']")).not.toBeNull();
    expect(button(el, "Export first")).toBeDefined();
    mustButton(el, "Yes, replace").click();
    expect(el.textContent).toContain("Imported: 1 added, 1 replaced.");
    expect(store.list().map((l) => l.name)).toEqual(["Cabin"]);
  });

  it("shows import errors", () => {
    const { el } = mount();
    type(el, "#import-text", "nope");
    mustButton(el, "Import").click();
    expect(el.querySelector(".error")?.textContent).toBe(
      "That file isn't a locations backup: it isn't valid JSON.",
    );
  });

  it("shows warnings for imports", () => {
    const { el } = mount();
    type(
      el,
      "#import-text",
      JSON.stringify({ locations: [{ name: "A", lat: 1, lon: 1 }, 5] }),
    );
    mustButton(el, "Import").click();
    expect(el.querySelector(".warnings li")?.textContent).toMatch(/Skipped/);
  });
});

describe("storage status in the view", () => {
  const key = (suffix: string) => `${DEFAULT_KEY}${suffix}`;
  const lockedControls = (el: HTMLElement) =>
    ["Rename", "Delete", "Re-resolve", "Add location", "Import"].map((label) =>
      button(el, label),
    );

  it("says when locations are not kept", () => {
    const { el, store } = mount({
      storage: createMemoryStorage({ failWrites: true }),
    });
    store.add({ name: "Home", lat: 39, lon: -97 });
    expect(el.textContent).toContain(
      "Locations are only kept until you close the app (storage unavailable).",
    );
  });

  it("stays quiet when storage is healthy", () => {
    expect(mount().el.querySelector("#storage-heading")).toBeNull();
  });

  it("explains a backup failure and disables changes", () => {
    const storage = createMemoryStorage({ failWrites: true });
    storage.data.set(key(""), "garbage");
    const { el, store } = mount({ storage });
    expect(el.querySelector("#storage-heading")).not.toBeNull();
    expect(el.textContent).toContain(store.readOnlyReason);
    expect(button(el, "Discard unreadable data and continue")).toBeDefined();
    expect(button(el, "Clear old backups")).toBeUndefined();
    expect(button(el, "Reload")).toBeUndefined();
    expect(mustButton(el, "Add location").disabled).toBe(true);
    expect(mustButton(el, "Import").disabled).toBe(true);
    expect(el.querySelector<HTMLInputElement>("#add-name")?.disabled).toBe(
      true,
    );
    expect(mustButton(el, "Export").disabled).toBe(false);
  });

  it("offers a download per backup and clearing when backups are full", () => {
    const storage = createMemoryStorage();
    storage.data.set(key(""), "garbage");
    storage.data.set(key(".corrupt"), "a");
    storage.data.set(key(".corrupt-2"), "b");
    storage.data.set(key(".corrupt-3"), "c");
    const { el, store } = mount({ storage });
    expect(store.readOnlyKind).toBe("backups-full");
    expect(
      buttons(el).filter((b) => b.textContent?.startsWith("Download backup")),
    ).toHaveLength(3);
    mustButton(el, "Clear old backups").click();
    expect(store.readOnly).toBe(false);
    expect(button(el, "Clear old backups")).toBeUndefined();
    expect(mustButton(el, "Add location").disabled).toBe(false);
  });

  it("confirms before discarding", () => {
    const storage = createMemoryStorage({ failWrites: true });
    storage.data.set(key(""), "garbage");
    const { el, store } = mount({ storage });
    mustButton(el, "Discard unreadable data").click();
    expect(store.readOnly).toBe(true);
    expect(el.querySelector("[aria-label='Confirm discard']")).not.toBeNull();
    mustButton(el, "Yes, discard").click();
    expect(store.readOnly).toBe(false);
  });

  it("offers Reload for data from a newer version", () => {
    const storage = createMemoryStorage();
    storage.data.set(
      key(""),
      '{"version":2,"locations":[{"name":"Home","lat":1,"lon":2}]}',
    );
    const { el, store } = mount({ storage });
    expect(store.readOnlyKind).toBe("newer");
    expect(button(el, "Reload")).toBeDefined();
    expect(button(el, "Discard unreadable data and continue")).toBeUndefined();
    expect(el.textContent).toContain(store.readOnlyReason);
    for (const control of lockedControls(el)) {
      if (control) expect(control.disabled).toBe(true);
    }
  });
});

describe("dashboard and location views", () => {
  it("keeps the empty state for an empty store", () => {
    const el = document.createElement("div");
    render(dashboardView([]), el);
    expect(el.textContent).toContain("No locations yet");
  });

  it("lists saved names as links, escaped", () => {
    const store = createLocationStore({ storage: createMemoryStorage() });
    const saved = store.add({ name: EVIL, lat: 39, lon: -97 });
    const el = document.createElement("div");
    render(dashboardView(store.list()), el);
    expect(el.querySelector("img")).toBeNull();
    const link = el.querySelector("a");
    expect(link?.textContent).toBe(EVIL);
    expect(link?.getAttribute("href")).toBe(`#/l/${saved.id}`);
  });

  it("shows the location name or a not-found message", () => {
    const el = document.createElement("div");
    render(
      locationView({ id: "a", name: EVIL, lat: 1, lon: 2, createdAt: "x" }),
      el,
    );
    expect(el.querySelector("h2")?.textContent).toBe(EVIL);
    expect(el.querySelector("img")).toBeNull();
    render(locationView(undefined), el);
    expect(el.querySelector("h2")?.textContent).toBe("Location not found");
  });
});
