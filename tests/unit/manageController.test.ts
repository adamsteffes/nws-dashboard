import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppContext, type GeolocationLike } from "../../src/app/context";
import { createManageController } from "../../src/app/manageController";
import { createNwsClient } from "../../src/nws/client";
import {
  createLocationStore,
  DEFAULT_KEY,
  type LocationStore,
} from "../../src/store/locations";
import { createFakeFetch, type Routes } from "../helpers/fakeFetch";
import {
  createMemoryStorage,
  type MemoryStorage,
} from "../helpers/memoryStorage";

const LINN = "https://api.weather.gov/points/39.7456,-97.0892";
const STATIONS = "https://api.weather.gov/gridpoints/TOP/32,81/stations";
const NOW = new Date("2026-11-14T12:00:00Z");

const noLastGood = {
  async get() {
    return undefined;
  },
  async put() {},
  async prune() {},
  async deleteByPrefix() {},
  async clear() {},
};

type SetupOptions = {
  routes?: Routes;
  storage?: MemoryStorage;
  online?: boolean;
  geolocation?: GeolocationLike;
  now?: () => Date;
};

function setup(options: SetupOptions = {}) {
  const storage = options.storage ?? createMemoryStorage();
  const store = createLocationStore({ storage });
  const fetchFn = createFakeFetch(
    options.routes ?? {
      [LINN]: "points_linn-ks",
      [STATIONS]: "stations_linn-ks",
    },
  );
  const client = createNwsClient({
    fetchFn,
    isOnline: () => options.online ?? true,
    sleep: async () => {},
    lastGood: noLastGood,
  });
  const ctx = createAppContext({
    store,
    client,
    lastGood: noLastGood,
    geolocation: options.geolocation,
    now: options.now ?? (() => NOW),
  });
  const onChange = vi.fn();
  const reload = vi.fn();
  const ctrl = createManageController(ctx, { onChange, reload });
  return { storage, store, fetchFn, ctrl, onChange, reload };
}

async function fillAndSubmit(
  ctrl: ReturnType<typeof setup>["ctrl"],
  name = "Linn",
  lat = "39.7456",
  lon = "-97.0892",
) {
  ctrl.actions.setAddField("name", name);
  ctrl.actions.setAddField("lat", lat);
  ctrl.actions.setAddField("lon", lon);
  await ctrl.actions.submitAdd();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createAppContext", () => {
  it("uses injected parts and hides geolocation when asked", () => {
    const store = createLocationStore({ storage: createMemoryStorage() });
    const ctx = createAppContext({ store, geolocation: undefined });
    expect(ctx.store).toBe(store);
    expect(ctx.geolocation).toBeUndefined();
    expect(ctx.now()).toBeInstanceOf(Date);
  });
});

describe("add location", () => {
  it("stores the location with NWS metadata", async () => {
    const { ctrl, store, fetchFn } = setup();
    await fillAndSubmit(ctrl);
    const [saved] = store.list();
    expect(saved?.name).toBe("Linn");
    expect(saved?.nws?.gridId).toBe("TOP");
    expect(saved?.nws?.radarStation).toBe("KTWX");
    expect(saved?.nws?.resolvedAt).toBe(NOW.toISOString());
    expect(saved?.nws?.stationIds.length).toBeGreaterThan(0);
    expect(fetchFn.calls.map((c) => c.url)).toEqual([LINN, STATIONS]);
    expect(ctrl.state.add.message).toEqual({
      kind: "info",
      text: "Added Linn.",
    });
    expect(ctrl.state.add.name).toBe("");
    expect(ctrl.state.add.busy).toBe(false);
  });

  it("is busy while looking up", async () => {
    const { ctrl } = setup();
    ctrl.actions.setAddField("name", "Linn");
    ctrl.actions.setAddField("lat", "39.7456");
    ctrl.actions.setAddField("lon", "-97.0892");
    const pending = ctrl.actions.submitAdd();
    expect(ctrl.state.add.busy).toBe(true);
    await pending;
    expect(ctrl.state.add.busy).toBe(false);
  });

  it("shows validation errors without any request", async () => {
    const { ctrl, store, fetchFn } = setup();
    await fillAndSubmit(ctrl, "", "39", "-97");
    expect(ctrl.state.add.message?.text).toBe(
      "Name must be 1 to 60 characters.",
    );
    await fillAndSubmit(ctrl, "X", "", "-97");
    expect(ctrl.state.add.message?.text).toMatch(/Latitude must be a number/);
    await fillAndSubmit(ctrl, "X", "39", "-200");
    expect(ctrl.state.add.message?.text).toBe(
      "Longitude must be between -180 and 180.",
    );
    expect(fetchFn.calls).toEqual([]);
    expect(store.list()).toEqual([]);
  });

  it("explains locations outside coverage", async () => {
    const { ctrl, store } = setup({ routes: { [LINN]: "points_404" } });
    await fillAndSubmit(ctrl);
    expect(ctrl.state.add.message).toEqual({
      kind: "error",
      text: "That spot is outside National Weather Service coverage (US and territories only).",
    });
    expect(ctrl.state.add.offerSaveWithout).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it("explains being offline", async () => {
    const { ctrl } = setup({ online: false });
    await fillAndSubmit(ctrl);
    expect(ctrl.state.add.message?.text).toBe(
      "You're offline — connect to add a location.",
    );
    expect(ctrl.state.add.offerSaveWithout).toBe(false);
  });

  it("offers to save without weather data after a server error", async () => {
    const { ctrl, store } = setup({ routes: { [LINN]: 500 } });
    await fillAndSubmit(ctrl);
    expect(ctrl.state.add.message?.text).toBe(
      "The Weather Service didn't respond. Try again.",
    );
    expect(ctrl.state.add.offerSaveWithout).toBe(true);
    expect(store.list()).toEqual([]);

    ctrl.actions.saveWithoutWeather();
    const [saved] = store.list();
    expect(saved?.name).toBe("Linn");
    expect(saved?.nws).toBeUndefined();
    expect(ctrl.state.add.offerSaveWithout).toBe(false);
    expect(ctrl.state.add.message?.text).toMatch(/without weather data/);
  });

  it("shows store errors", async () => {
    const storage = createMemoryStorage();
    const { ctrl, store } = setup({ storage });
    // Existing stored data means a failed save is refused, not kept in memory.
    store.add({ name: "Home", lat: 39, lon: -97 });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await fillAndSubmit(ctrl);
    expect(ctrl.state.add.message).toEqual({
      kind: "error",
      text: "Couldn't save — storage is full or unavailable. Your change was not kept.",
    });
  });

  it("accepts a decimal comma", async () => {
    const { ctrl, store } = setup();
    await fillAndSubmit(ctrl, "Linn", "39,7456", "-97,0892");
    expect(store.list()).toHaveLength(1);
  });
});

describe("use my location", () => {
  const position = (latitude: number, longitude: number) =>
    ({ coords: { latitude, longitude } }) as GeolocationPosition;

  it("fills coordinates and suggests a name", async () => {
    const { ctrl } = setup({
      geolocation: {
        getCurrentPosition: (ok) => ok(position(39.745612, -97.089234)),
      },
    });
    await ctrl.actions.useMyLocation();
    expect(ctrl.state.add).toMatchObject({
      name: "My location",
      lat: "39.7456",
      lon: "-97.0892",
      locating: false,
    });
  });

  it("keeps a name the user already typed", async () => {
    const { ctrl } = setup({
      geolocation: { getCurrentPosition: (ok) => ok(position(1, 2)) },
    });
    ctrl.actions.setAddField("name", "Cabin");
    await ctrl.actions.useMyLocation();
    expect(ctrl.state.add.name).toBe("Cabin");
  });

  it.each([
    [1, /denied/],
    [2, /isn't available/],
    [3, /took too long/],
  ])("explains geolocation error %i", async (code, text) => {
    const { ctrl } = setup({
      geolocation: {
        getCurrentPosition: (_ok, fail) =>
          fail?.({ code } as GeolocationPositionError),
      },
    });
    await ctrl.actions.useMyLocation();
    expect(ctrl.state.add.message?.kind).toBe("error");
    expect(ctrl.state.add.message?.text).toMatch(text);
    expect(ctrl.state.add.lat).toBe("");
  });

  it("reports whether geolocation is available", () => {
    expect(setup().ctrl.viewProps().canGeolocate).toBe(false);
    const geolocation = { getCurrentPosition: () => {} };
    expect(setup({ geolocation }).ctrl.viewProps().canGeolocate).toBe(true);
  });
});

describe("rename, delete and re-resolve", () => {
  it("renames a location", () => {
    const { ctrl, store } = setup();
    const { id } = store.add({ name: "Home", lat: 39, lon: -97 });
    ctrl.actions.startRename(id);
    expect(ctrl.state.list.renameValue).toBe("Home");
    ctrl.actions.setRenameValue("Cabin");
    ctrl.actions.submitRename();
    expect(store.get(id)?.name).toBe("Cabin");
    expect(ctrl.state.list.renamingId).toBeNull();
  });

  it("keeps the rename form open on an invalid name", () => {
    const { ctrl, store } = setup();
    const { id } = store.add({ name: "Home", lat: 39, lon: -97 });
    ctrl.actions.startRename(id);
    ctrl.actions.setRenameValue("   ");
    ctrl.actions.submitRename();
    expect(ctrl.state.list.renamingId).toBe(id);
    expect(ctrl.state.list.renameError).toBe(
      "Name must be 1 to 60 characters.",
    );
    expect(store.get(id)?.name).toBe("Home");
    ctrl.actions.cancelRename();
    expect(ctrl.state.list.renamingId).toBeNull();
  });

  it("deletes only after confirmation", () => {
    const { ctrl, store } = setup();
    const { id } = store.add({ name: "Home", lat: 39, lon: -97 });
    ctrl.actions.askDelete(id);
    expect(store.list()).toHaveLength(1);
    ctrl.actions.cancelDelete();
    expect(ctrl.state.list.deletingId).toBeNull();
    expect(store.list()).toHaveLength(1);
    ctrl.actions.askDelete(id);
    ctrl.actions.confirmDelete();
    expect(store.list()).toEqual([]);
    expect(ctrl.state.list.message?.text).toBe("Deleted Home.");
  });

  it("re-resolves with a refresh and updates resolvedAt", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const { ctrl, store, fetchFn } = setup({ now: () => now });
    await fillAndSubmit(ctrl);
    const [first] = store.list();
    expect(first?.nws?.resolvedAt).toBe("2026-01-01T00:00:00.000Z");

    now = new Date("2026-02-02T00:00:00Z");
    // The fake fetch answers every call to a URL, so a second lookup works.
    await ctrl.actions.reresolve((first as { id: string }).id);
    expect(store.list()[0]?.nws?.resolvedAt).toBe("2026-02-02T00:00:00.000Z");
    const refreshCall = fetchFn.calls.filter((c) => c.url === LINN).at(-1);
    expect(refreshCall?.init?.cache).toBe("no-cache");
    expect(ctrl.state.list.message?.text).toBe(
      "Updated weather data for Linn.",
    );
    expect(ctrl.state.list.busyId).toBeNull();
  });

  it("reports a failed re-resolve and keeps the old data", async () => {
    const { ctrl, store } = setup({ routes: { [LINN]: 500 } });
    const { id } = store.add({ name: "Home", lat: 39.7456, lon: -97.0892 });
    await ctrl.actions.reresolve(id);
    expect(ctrl.state.list.message).toEqual({
      kind: "error",
      text: "The Weather Service didn't respond. Try again.",
    });
    expect(store.get(id)?.nws).toBeUndefined();
  });
});

describe("export", () => {
  const seed = (store: LocationStore) =>
    store.add({ name: "Home", lat: 39, lon: -97 });

  it("shares a file when the browser can", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { share, canShare });
    const { ctrl, store } = setup();
    seed(store);
    await ctrl.actions.exportData();
    expect(share).toHaveBeenCalledOnce();
    const { files } = (share.mock.calls[0]?.[0] ?? {}) as { files: File[] };
    expect(files[0]?.name).toBe("nws-dashboard-locations-2026-11-14.json");
    expect(files[0]?.type).toBe("application/json");
    expect(ctrl.state.backup.message?.text).toBe("Exported.");
  });

  it("does not fall back after the user cancels sharing", async () => {
    const abort = Object.assign(new Error("cancel"), { name: "AbortError" });
    vi.stubGlobal("navigator", {
      share: vi.fn().mockRejectedValue(abort),
      canShare: () => true,
    });
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL });
    const { ctrl } = setup();
    await ctrl.actions.exportData();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(ctrl.state.backup.message?.text).toBe("Export cancelled.");
  });

  it("downloads through an object URL when sharing is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const createObjectURL = vi.fn().mockReturnValue("blob:x");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const { ctrl, store } = setup();
    seed(store);
    await ctrl.actions.exportData();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(ctrl.state.backup.shown).toBeNull();
    expect(ctrl.state.backup.message?.text).toBe(
      "Saved nws-dashboard-locations-2026-11-14.json.",
    );
  });

  it("shows the JSON when nothing else works, and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("URL", {});
    const { ctrl, store } = setup();
    seed(store);
    await ctrl.actions.exportData();
    const shown = ctrl.state.backup.shown;
    expect(JSON.parse(shown?.json ?? "").locations[0].name).toBe("Home");
    await ctrl.actions.copyExport();
    expect(writeText).toHaveBeenCalledWith(shown?.json);
    expect(ctrl.state.backup.message?.text).toBe("Copied to the clipboard.");
  });

  it("explains a failed copy", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
    });
    vi.stubGlobal("URL", {});
    const { ctrl } = setup();
    await ctrl.actions.exportData();
    await ctrl.actions.copyExport();
    expect(ctrl.state.backup.message?.kind).toBe("error");
  });
});

describe("import", () => {
  const file = (names: string[]) =>
    JSON.stringify({
      version: 1,
      locations: names.map((name, i) => ({ name, lat: 30 + i, lon: -90 })),
    });

  it("merges by default and reports counts", () => {
    const { ctrl, store } = setup();
    store.add({ name: "Home", lat: 30, lon: -90 });
    ctrl.actions.setImportText(file(["Home", "Cabin"]));
    ctrl.actions.requestImport();
    expect(store.list().map((l) => l.name)).toEqual(["Home", "Cabin"]);
    expect(ctrl.state.import.result).toMatchObject({ added: 1, skipped: 1 });
    expect(ctrl.state.import.text).toBe("");
  });

  it("asks before replacing, and replaces on confirm", () => {
    const { ctrl, store } = setup();
    store.add({ name: "Home", lat: 39, lon: -97 });
    ctrl.actions.setImportMode("replace");
    ctrl.actions.setImportText(file(["Cabin"]));
    ctrl.actions.requestImport();
    expect(ctrl.state.import.confirmReplace).toBe(true);
    expect(store.list().map((l) => l.name)).toEqual(["Home"]);
    ctrl.actions.confirmReplace();
    expect(store.list().map((l) => l.name)).toEqual(["Cabin"]);
    expect(ctrl.state.import.result).toMatchObject({ added: 1, replaced: 1 });
    expect(ctrl.state.import.confirmReplace).toBe(false);
  });

  it("cancelling a replace changes nothing", () => {
    const { ctrl, store } = setup();
    store.add({ name: "Home", lat: 39, lon: -97 });
    ctrl.actions.setImportMode("replace");
    ctrl.actions.setImportText(file(["Cabin"]));
    ctrl.actions.requestImport();
    ctrl.actions.cancelReplace();
    expect(ctrl.state.import.confirmReplace).toBe(false);
    expect(store.list().map((l) => l.name)).toEqual(["Home"]);
  });

  it("shows validation errors and never asks to confirm a bad file", () => {
    const { ctrl } = setup();
    ctrl.actions.setImportMode("replace");
    ctrl.actions.setImportText("not json");
    ctrl.actions.requestImport();
    expect(ctrl.state.import.error).toBe(
      "That file isn't a locations backup: it isn't valid JSON.",
    );
    expect(ctrl.state.import.confirmReplace).toBe(false);
    ctrl.actions.setImportMode("merge");
    ctrl.actions.requestImport();
    expect(ctrl.state.import.error).toMatch(/isn't valid JSON/);
  });

  it("asks for input when empty", () => {
    const { ctrl } = setup();
    ctrl.actions.requestImport();
    expect(ctrl.state.import.error).toBe(
      "Choose a file or paste the backup text first.",
    );
  });

  it("loads a chosen file into the text box", async () => {
    const { ctrl } = setup();
    await ctrl.actions.loadImportFile(
      new File([file(["Cabin"])], "x.json", { type: "application/json" }),
    );
    expect(JSON.parse(ctrl.state.import.text).locations).toHaveLength(1);
  });

  it("surfaces warnings", () => {
    const { ctrl } = setup();
    ctrl.actions.setImportText(
      JSON.stringify({
        locations: [
          { name: "Ok", lat: 1, lon: 1 },
          { name: "", lat: 1, lon: 1 },
        ],
      }),
    );
    ctrl.actions.requestImport();
    expect(ctrl.state.import.result?.warnings[0]).toMatch(/Skipped entry/);
  });
});

describe("storage problems", () => {
  const key = (suffix: string) => `${DEFAULT_KEY}${suffix}`;

  function unreadable(kind: "backup" | "backups-full" | "newer") {
    const storage = createMemoryStorage({ failWrites: kind === "backup" });
    storage.data.set(
      key(""),
      kind === "newer" ? '{"version":2,"locations":[]}' : "garbage",
    );
    if (kind === "backups-full") {
      storage.data.set(key(".corrupt"), "a");
      storage.data.set(key(".corrupt-2"), "b");
      storage.data.set(key(".corrupt-3"), "c");
    }
    return setup({ storage });
  }

  it("flags storage that is not persistent", () => {
    const { ctrl, store } = setup({
      storage: createMemoryStorage({ failWrites: true }),
    });
    store.add({ name: "Home", lat: 39, lon: -97 });
    expect(ctrl.viewProps().storage.persistent).toBe(false);
  });

  it("discards unreadable data after a confirm step", () => {
    const { ctrl, store } = unreadable("backup");
    expect(ctrl.viewProps().storage).toMatchObject({
      readOnly: true,
      readOnlyKind: "backup",
      corrupt: true,
    });
    ctrl.actions.askDiscard();
    expect(ctrl.state.confirmDiscard).toBe(true);
    expect(store.readOnly).toBe(true);
    ctrl.actions.confirmDiscard();
    expect(store.readOnly).toBe(false);
    expect(ctrl.state.confirmDiscard).toBe(false);
  });

  it("keeps everything when the discard is cancelled", () => {
    const { ctrl, store } = unreadable("backup");
    ctrl.actions.askDiscard();
    ctrl.actions.cancelDiscard();
    expect(ctrl.state.confirmDiscard).toBe(false);
    expect(store.readOnly).toBe(true);
  });

  it("clears old backups to resume", () => {
    const { ctrl, store } = unreadable("backups-full");
    expect(store.readOnlyKind).toBe("backups-full");
    expect(ctrl.viewProps().storage.backups).toHaveLength(3);
    ctrl.actions.clearBackups();
    expect(store.readOnly).toBe(false);
    expect(ctrl.viewProps().storage.backups).toHaveLength(1);
  });

  it("downloads a backup copy", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:x");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const { ctrl } = unreadable("backups-full");
    ctrl.actions.downloadBackup(key(".corrupt-2"));
    expect(click).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.size).toBe(1);
    expect(ctrl.state.storageMessage?.text).toBe(
      "Saved nws-dashboard-unreadable-backup-2.json.",
    );
  });

  it("shows the backup text when downloads are unavailable", () => {
    vi.stubGlobal("URL", {});
    const { ctrl } = unreadable("backups-full");
    ctrl.actions.downloadBackup(key(".corrupt"));
    expect(ctrl.state.backup.shown).toEqual({
      filename: "nws-dashboard-unreadable-backup-1.json",
      json: "a",
    });
  });

  it("reloads for data from a newer app version", () => {
    const { ctrl, reload } = unreadable("newer");
    expect(ctrl.viewProps().storage.readOnlyKind).toBe("newer");
    ctrl.actions.reload();
    expect(reload).toHaveBeenCalledOnce();
  });
});
