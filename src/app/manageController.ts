import { NwsError, NwsNotFound, NwsOfflineError } from "../nws/errors";
import { fetchStations, resolvePoint, roundCoord } from "../nws/points";
import {
  checkLocationInput,
  metaFromPoint,
  type NwsMeta,
  type ReadOnlyKind,
  type SavedLocation,
} from "../store/locations";
import {
  exportLocations,
  type ImportResult,
  importLocations,
  validateLocationsFile,
} from "../store/transfer";
import type { AppContext } from "./context";

export type Message = { kind: "info" | "error"; text: string };

export type ImportMode = "merge" | "replace";

export type ManageState = {
  add: {
    name: string;
    lat: string;
    lon: string;
    busy: boolean;
    locating: boolean;
    message: Message | null;
    /** Set after a Weather Service failure that saving without data works around. */
    offerSaveWithout: boolean;
  };
  list: {
    message: Message | null;
    renamingId: string | null;
    renameValue: string;
    renameError: string | null;
    deletingId: string | null;
    busyId: string | null;
  };
  backup: {
    message: Message | null;
    /** Shown in a read-only textarea when neither sharing nor downloading works. */
    shown: { filename: string; json: string } | null;
  };
  import: {
    text: string;
    mode: ImportMode;
    confirmReplace: boolean;
    result: ImportResult | null;
    error: string | null;
  };
  confirmDiscard: boolean;
  storageMessage: Message | null;
};

export type StorageStatus = {
  persistent: boolean;
  corrupt: boolean;
  dropped: number;
  readOnly: boolean;
  readOnlyKind: ReadOnlyKind | null;
  readOnlyReason: string | null;
  backups: { key: string; size: number }[];
};

export type ManageActions = {
  setAddField(field: "name" | "lat" | "lon", value: string): void;
  submitAdd(): Promise<void>;
  saveWithoutWeather(): void;
  useMyLocation(): Promise<void>;
  startRename(id: string): void;
  setRenameValue(value: string): void;
  submitRename(): void;
  cancelRename(): void;
  askDelete(id: string): void;
  confirmDelete(): void;
  cancelDelete(): void;
  reresolve(id: string): Promise<void>;
  exportData(): Promise<void>;
  copyExport(): Promise<void>;
  setImportText(text: string): void;
  loadImportFile(file: File): Promise<void>;
  setImportMode(mode: ImportMode): void;
  requestImport(): void;
  confirmReplace(): void;
  cancelReplace(): void;
  downloadBackup(key: string): void;
  clearBackups(): void;
  askDiscard(): void;
  confirmDiscard(): void;
  cancelDiscard(): void;
  reload(): void;
};

export type ManageViewProps = {
  state: ManageState;
  locations: SavedLocation[];
  storage: StorageStatus;
  canGeolocate: boolean;
  actions: ManageActions;
};

export type ManageController = {
  state: ManageState;
  actions: ManageActions;
  viewProps(): ManageViewProps;
};

export type ManageControllerOptions = {
  /** Called after every state change so the caller can re-render. */
  onChange: () => void;
  reload?: () => void;
};

const OUTSIDE_COVERAGE =
  "That spot is outside National Weather Service coverage (US and territories only).";
const OFFLINE_ADD = "You're offline — connect to add a location.";
const OFFLINE_LOOKUP = "You're offline — connect to look up weather data.";
const NO_RESPONSE = "The Weather Service didn't respond. Try again.";

const error = (text: string): Message => ({ kind: "error", text });
const info = (text: string): Message => ({ kind: "info", text });
const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** Lenient number parsing for typed coordinates; blank is not zero. */
function parseCoord(text: string): number {
  const trimmed = text.trim().replace(",", ".");
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

function describeNwsFailure(
  e: unknown,
  offline: string,
): { text: string; retryable: boolean } {
  if (e instanceof NwsNotFound) {
    return { text: OUTSIDE_COVERAGE, retryable: false };
  }
  if (e instanceof NwsOfflineError) return { text: offline, retryable: false };
  return { text: NO_RESPONSE, retryable: true };
}

const GEOLOCATION_ERRORS: Record<number, string> = {
  1: "Location access was denied. Allow it in your browser or device settings, or type the coordinates instead.",
  2: "Your location isn't available right now. Type the coordinates instead.",
  3: "Finding your location took too long. Try again or type the coordinates.",
};

function share(file: File): Promise<"shared" | "cancelled" | "unavailable"> {
  if (
    typeof navigator.share !== "function" ||
    !navigator.canShare?.({ files: [file] })
  ) {
    return Promise.resolve("unavailable");
  }
  return navigator.share({ files: [file] }).then(
    () => "shared" as const,
    (e: unknown) =>
      e instanceof Error && e.name === "AbortError"
        ? ("cancelled" as const)
        : ("unavailable" as const),
  );
}

/** Returns false when the browser can't create object URLs. */
function download(filename: string, text: string): boolean {
  if (typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking right away can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export function createManageController(
  ctx: AppContext,
  options: ManageControllerOptions,
): ManageController {
  const { store, client } = ctx;
  const changed = options.onChange;
  const reload = options.reload ?? (() => window.location.reload());

  const state: ManageState = {
    add: {
      name: "",
      lat: "",
      lon: "",
      busy: false,
      locating: false,
      message: null,
      offerSaveWithout: false,
    },
    list: {
      message: null,
      renamingId: null,
      renameValue: "",
      renameError: null,
      deletingId: null,
      busyId: null,
    },
    backup: { message: null, shown: null },
    import: {
      text: "",
      mode: "merge",
      confirmReplace: false,
      result: null,
      error: null,
    },
    confirmDiscard: false,
    storageMessage: null,
  };

  const readAddForm = () => ({
    name: state.add.name,
    lat: parseCoord(state.add.lat),
    lon: parseCoord(state.add.lon),
  });

  function commitAdd(
    input: { name: string; lat: number; lon: number },
    nws?: NwsMeta,
  ) {
    const a = state.add;
    try {
      const saved = store.add(nws ? { ...input, nws } : input);
      a.name = "";
      a.lat = "";
      a.lon = "";
      a.offerSaveWithout = false;
      a.message = info(
        nws
          ? `Added ${saved.name}.`
          : `Added ${saved.name} without weather data. Use Re-resolve later to look it up.`,
      );
    } catch (e) {
      a.message = error(errorText(e));
    }
  }

  async function lookUp(lat: number, lon: number, refresh: boolean) {
    const point = await resolvePoint(client, lat, lon, { refresh });
    const stations = await fetchStations(
      client,
      point.data.observationStationsUrl,
    );
    return metaFromPoint(point.data, stations.data, ctx.now());
  }

  function runImport() {
    const i = state.import;
    i.confirmReplace = false;
    try {
      i.result = importLocations(store, i.text, i.mode);
      i.error = null;
      i.text = "";
    } catch (e) {
      i.result = null;
      i.error = errorText(e);
    }
    changed();
  }

  const actions: ManageActions = {
    setAddField(field, value) {
      state.add[field] = value;
      state.add.offerSaveWithout = false;
      changed();
    },

    async submitAdd() {
      const a = state.add;
      if (a.busy) return;
      const input = readAddForm();
      const problem = checkLocationInput(input.name, input.lat, input.lon);
      a.offerSaveWithout = false;
      if (problem !== null) {
        a.message = error(problem);
        changed();
        return;
      }
      a.busy = true;
      a.message = info("Looking up this location…");
      changed();
      try {
        commitAdd(input, await lookUp(input.lat, input.lon, false));
      } catch (e) {
        const failure = describeNwsFailure(e, OFFLINE_ADD);
        a.message = error(failure.text);
        a.offerSaveWithout = failure.retryable;
      }
      a.busy = false;
      changed();
    },

    saveWithoutWeather() {
      const input = readAddForm();
      const problem = checkLocationInput(input.name, input.lat, input.lon);
      if (problem !== null) {
        state.add.message = error(problem);
      } else {
        commitAdd(input);
      }
      changed();
    },

    async useMyLocation() {
      const geolocation = ctx.geolocation;
      const a = state.add;
      if (!geolocation || a.locating) return;
      a.locating = true;
      a.message = info("Finding your location…");
      changed();
      await new Promise<void>((resolve) => {
        geolocation.getCurrentPosition(
          (position) => {
            a.lat = String(roundCoord(position.coords.latitude));
            a.lon = String(roundCoord(position.coords.longitude));
            if (a.name.trim() === "") a.name = "My location";
            a.offerSaveWithout = false;
            a.message = info("Location found. Check the name, then add it.");
            resolve();
          },
          (failure) => {
            a.message = error(
              GEOLOCATION_ERRORS[failure.code] ??
                "Couldn't get your location. Type the coordinates instead.",
            );
            resolve();
          },
          { timeout: 10_000, maximumAge: 60_000 },
        );
      });
      a.locating = false;
      changed();
    },

    startRename(id) {
      const found = store.get(id);
      if (!found) return;
      Object.assign(state.list, {
        renamingId: id,
        renameValue: found.name,
        renameError: null,
        deletingId: null,
      });
      changed();
    },
    setRenameValue(value) {
      state.list.renameValue = value;
      changed();
    },
    submitRename() {
      const l = state.list;
      if (l.renamingId === null) return;
      try {
        const renamed = store.rename(l.renamingId, l.renameValue);
        l.renamingId = null;
        l.renameError = null;
        l.message = info(`Renamed to ${renamed.name}.`);
      } catch (e) {
        l.renameError = errorText(e);
      }
      changed();
    },
    cancelRename() {
      state.list.renamingId = null;
      state.list.renameError = null;
      changed();
    },

    askDelete(id) {
      state.list.deletingId = id;
      state.list.renamingId = null;
      changed();
    },
    confirmDelete() {
      const l = state.list;
      if (l.deletingId === null) return;
      const name = store.get(l.deletingId)?.name;
      try {
        store.remove(l.deletingId);
        l.message = info(`Deleted ${name ?? "the location"}.`);
      } catch (e) {
        l.message = error(errorText(e));
      }
      l.deletingId = null;
      changed();
    },
    cancelDelete() {
      state.list.deletingId = null;
      changed();
    },

    async reresolve(id) {
      const l = state.list;
      const found = store.get(id);
      if (!found || l.busyId !== null) return;
      l.busyId = id;
      l.message = info(`Looking up ${found.name}…`);
      changed();
      try {
        store.updateMeta(id, await lookUp(found.lat, found.lon, true));
        l.message = info(`Updated weather data for ${found.name}.`);
      } catch (e) {
        l.message = error(
          e instanceof NwsError
            ? describeNwsFailure(e, OFFLINE_LOOKUP).text
            : errorText(e),
        );
      }
      l.busyId = null;
      changed();
    },

    async exportData() {
      const b = state.backup;
      const { filename, json } = exportLocations(store, ctx.now());
      b.shown = null;
      // No await before share(): iOS requires it inside the tap's user activation.
      const outcome = await share(
        new File([json], filename, { type: "application/json" }),
      );
      if (outcome === "shared") {
        b.message = info("Exported.");
      } else if (outcome === "cancelled") {
        b.message = info("Export cancelled.");
      } else if (download(filename, json)) {
        b.message = info(`Saved ${filename}.`);
      } else {
        b.shown = { filename, json };
        b.message = info("Copy this text and keep it somewhere safe.");
      }
      changed();
    },
    async copyExport() {
      const b = state.backup;
      if (!b.shown) return;
      try {
        await navigator.clipboard.writeText(b.shown.json);
        b.message = info("Copied to the clipboard.");
      } catch {
        b.message = error(
          "Couldn't copy automatically. Select the text and copy it yourself.",
        );
      }
      changed();
    },

    setImportText(text) {
      state.import.text = text;
      state.import.error = null;
      state.import.result = null;
      state.import.confirmReplace = false;
      changed();
    },
    async loadImportFile(file) {
      try {
        actions.setImportText(await file.text());
      } catch {
        state.import.error = "Couldn't read that file.";
        changed();
      }
    },
    setImportMode(mode) {
      state.import.mode = mode;
      state.import.confirmReplace = false;
      changed();
    },
    requestImport() {
      const i = state.import;
      i.result = null;
      i.error = null;
      if (i.text.trim() === "") {
        i.error = "Choose a file or paste the backup text first.";
      } else if (i.mode === "replace") {
        const checked = validateLocationsFile(i.text);
        if (checked.ok) i.confirmReplace = true;
        else i.error = checked.error;
      } else {
        runImport();
        return;
      }
      changed();
    },
    confirmReplace: runImport,
    cancelReplace() {
      state.import.confirmReplace = false;
      changed();
    },

    downloadBackup(key) {
      const raw = store.readBackup(key);
      if (raw === null) {
        state.storageMessage = error("That backup couldn't be read.");
      } else {
        const number = key.endsWith("corrupt") ? 1 : key.slice(-1);
        const filename = `nws-dashboard-unreadable-backup-${number}.json`;
        if (download(filename, raw)) {
          state.storageMessage = info(`Saved ${filename}.`);
        } else {
          state.backup.shown = { filename, json: raw };
          state.storageMessage = info(
            "Downloads aren't available here. The backup text is shown under Backup — copy it from there.",
          );
        }
      }
      changed();
    },
    clearBackups() {
      store.clearBackups();
      state.storageMessage = info("Old backups cleared.");
      changed();
    },
    askDiscard() {
      state.confirmDiscard = true;
      changed();
    },
    confirmDiscard() {
      store.discardCorrupt();
      state.confirmDiscard = false;
      state.storageMessage = info("Unreadable data discarded.");
      changed();
    },
    cancelDiscard() {
      state.confirmDiscard = false;
      changed();
    },
    reload,
  };

  return {
    state,
    actions,
    viewProps() {
      return {
        state,
        locations: store.list(),
        storage: {
          persistent: store.persistent,
          corrupt: store.corrupt,
          dropped: store.dropped,
          readOnly: store.readOnly,
          readOnlyKind: store.readOnlyKind,
          readOnlyReason: store.readOnlyReason,
          backups: store.listBackups(),
        },
        canGeolocate: ctx.geolocation !== undefined,
        actions,
      };
    },
  };
}
