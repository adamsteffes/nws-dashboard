import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppContext } from "../../src/app/context";
import { createManageController } from "../../src/app/manageController";
import { createNwsClient } from "../../src/nws/client";
import { createLocationStore } from "../../src/store/locations";
import { createFakeFetch } from "../helpers/fakeFetch";
import { createMemoryStorage } from "../helpers/memoryStorage";

const LINN = "https://api.weather.gov/points/39.7456,-97.0892";
const STATIONS = "https://api.weather.gov/gridpoints/TOP/32,81/stations";

const noLastGood = {
  async get() {
    return undefined;
  },
  async put() {},
  async prune() {},
  async deleteByPrefix() {},
  async clear() {},
};

function setup(
  routes = { [LINN]: "points_linn-ks", [STATIONS]: "stations_linn-ks" },
) {
  const store = createLocationStore({ storage: createMemoryStorage() });
  const client = createNwsClient({
    fetchFn: createFakeFetch(routes),
    isOnline: () => true,
    sleep: async () => {},
    lastGood: noLastGood,
  });
  const ctx = createAppContext({
    store,
    client,
    lastGood: noLastGood,
    geolocation: undefined,
  });
  const ctrl = createManageController(ctx, {
    onChange: vi.fn(),
    reload: vi.fn(),
  });
  return { store, ctrl };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("re-resolve races", () => {
  it("drops the result when the id was deleted and re-added elsewhere", async () => {
    const { store, ctrl } = setup();
    store.add({ name: "Home", lat: 39.7456, lon: -97.0892 });
    const pending = ctrl.actions.reresolve("home");
    // Another tab does this; the busy row's own Delete is disabled.
    store.remove("home");
    store.add({ name: "Home", lat: 21.3, lon: -157.8 });
    await pending;
    expect(store.get("home")?.nws).toBeUndefined();
    expect(ctrl.state.list.message).toEqual({
      kind: "error",
      text: "Home changed while updating — try again.",
    });
    expect(ctrl.state.list.busyId).toBeNull();
  });

  it("says so when the location was removed meanwhile", async () => {
    const { store, ctrl } = setup();
    store.add({ name: "Home", lat: 39.7456, lon: -97.0892 });
    const pending = ctrl.actions.reresolve("home");
    store.remove("home");
    await pending;
    expect(ctrl.state.list.message).toEqual({
      kind: "error",
      text: "That location was removed.",
    });
  });

  it("maps the store's missing-location error", async () => {
    const { store, ctrl } = setup();
    store.add({ name: "Home", lat: 39.7456, lon: -97.0892 });
    ctrl.actions.startRename("home");
    store.remove("home");
    ctrl.actions.submitRename();
    expect(ctrl.state.list.renameError).toBe("That location was removed.");
  });

  it("still updates when nothing changed", async () => {
    const { store, ctrl } = setup();
    store.add({ name: "Home", lat: 39.7456, lon: -97.0892 });
    await ctrl.actions.reresolve("home");
    expect(store.get("home")?.nws?.city).toBe("Linn");
  });

  it("won't rename or delete a row while it is updating", async () => {
    const { store, ctrl } = setup();
    store.add({ name: "Home", lat: 39.7456, lon: -97.0892 });
    const pending = ctrl.actions.reresolve("home");
    ctrl.actions.startRename("home");
    ctrl.actions.askDelete("home");
    expect(ctrl.state.list.renamingId).toBeNull();
    expect(ctrl.state.list.deletingId).toBeNull();
    await pending;
  });
});

describe("add form while a lookup is pending", () => {
  const fill = (ctrl: ReturnType<typeof setup>["ctrl"]) => {
    ctrl.actions.setAddField("name", "Linn");
    ctrl.actions.setAddField("lat", "39.7456");
    ctrl.actions.setAddField("lon", "-97.0892");
  };

  it("keeps text typed after submitting", async () => {
    const { store, ctrl } = setup();
    fill(ctrl);
    const pending = ctrl.actions.submitAdd();
    ctrl.actions.setAddField("name", "Second");
    ctrl.actions.setAddField("lat", "30");
    await pending;
    expect(store.list().map((l) => l.name)).toEqual(["Linn"]);
    expect(ctrl.state.add).toMatchObject({
      name: "Second",
      lat: "30",
      lon: "",
    });
  });

  it("saves the input that failed, not the current fields", async () => {
    const { store, ctrl } = setup({ [LINN]: 500 } as never);
    fill(ctrl);
    await ctrl.actions.submitAdd();
    expect(ctrl.state.add.offerSaveWithout).toBe(true);
    // Editing hides the offer, but even a stale click must not save new text.
    ctrl.actions.saveWithoutWeather();
    expect(store.list()).toMatchObject([{ name: "Linn", lat: 39.7456 }]);
    expect(ctrl.state.add.name).toBe("");
  });

  it("ignores Save without weather data when nothing failed", () => {
    const { store, ctrl } = setup();
    fill(ctrl);
    ctrl.actions.saveWithoutWeather();
    expect(store.list()).toEqual([]);
  });

  it("marks the failing field and requests focus on it", () => {
    const { ctrl } = setup();
    ctrl.actions.setAddField("name", "X");
    ctrl.actions.setAddField("lat", "abc");
    ctrl.actions.setAddField("lon", "-97");
    void ctrl.actions.submitAdd();
    expect(ctrl.state.add.errorField).toBe("lat");
    const input = document.createElement("input");
    input.id = "add-lat";
    document.body.append(input);
    ctrl.applyFocus();
    expect(document.activeElement).toBe(input);
    input.remove();
    ctrl.actions.setAddField("lat", "39");
    expect(ctrl.state.add.errorField).toBeNull();
  });

  it("accepts hemisphere letters in submitted coordinates", async () => {
    const { store, ctrl } = setup();
    ctrl.actions.setAddField("name", "Linn");
    ctrl.actions.setAddField("lat", "39.7456 N");
    ctrl.actions.setAddField("lon", "97.0892 W");
    await ctrl.actions.submitAdd();
    expect(store.get("linn")?.lon).toBe(-97.0892);
  });
});

describe("clearing backups and resetting", () => {
  it("needs a confirm step before clearing", () => {
    const storage = createMemoryStorage();
    storage.data.set("nwsdash:locations:v1", "garbage");
    for (const [i, k] of ["", "-2", "-3"].entries()) {
      storage.data.set(`nwsdash:locations:v1.corrupt${k}`, String(i));
    }
    const store = createLocationStore({ storage });
    const ctrl = createManageController(
      createAppContext({ store, geolocation: undefined }),
      {
        onChange: vi.fn(),
      },
    );
    expect(store.readOnlyKind).toBe("backups-full");
    ctrl.actions.askClearBackups();
    expect(ctrl.state.confirmClear).toBe(true);
    expect(store.listBackups()).toHaveLength(3);
    ctrl.actions.cancelClearBackups();
    expect(ctrl.state.confirmClear).toBe(false);
    expect(store.readOnly).toBe(true);
    ctrl.actions.askClearBackups();
    ctrl.actions.clearBackups();
    expect(ctrl.state.confirmClear).toBe(false);
    expect(store.readOnly).toBe(false);
  });

  it("reset clears confirms, shown backup and messages but keeps typed text", () => {
    const { store, ctrl } = setup();
    store.add({ name: "Home", lat: 39, lon: -97 });
    ctrl.actions.askDelete("home");
    ctrl.actions.askDiscard();
    ctrl.actions.askClearBackups();
    ctrl.actions.setAddField("name", "Draft");
    ctrl.actions.setImportText("{}");
    ctrl.actions.setImportMode("replace");
    ctrl.state.backup.shown = { filename: "x", json: "y" };
    ctrl.state.list.message = { kind: "info", text: "m" };
    ctrl.state.add.message = { kind: "error", text: "e" };
    ctrl.reset();
    expect(ctrl.state.list).toMatchObject({ deletingId: null, message: null });
    expect(ctrl.state).toMatchObject({
      confirmDiscard: false,
      confirmClear: false,
    });
    expect(ctrl.state.backup).toEqual({ message: null, shown: null });
    expect(ctrl.state.add.message).toBeNull();
    expect(ctrl.state.add.name).toBe("Draft");
    expect(ctrl.state.import.text).toBe("{}");
  });
});

describe("large import files", () => {
  it("refuses files over 1 MB without reading them", async () => {
    const { ctrl } = setup();
    const file = new File(["{}"], "big.json");
    Object.defineProperty(file, "size", { value: 1_000_001 });
    const text = vi.spyOn(file, "text");
    await ctrl.actions.loadImportFile(file);
    expect(text).not.toHaveBeenCalled();
    expect(ctrl.state.import.error).toBe(
      "That file isn't a locations backup: it is larger than 1 MB.",
    );
  });
});
