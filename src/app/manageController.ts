import { NwsError, NwsNotFound, NwsOfflineError } from "../nws/errors";
import { roundCoord } from "../nws/points";
import { resolveLocation } from "../services/resolveLocation";
import {
  checkLocationInput,
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
import { parseCoord } from "./coords";

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
    /** The field the validation error belongs to, so the view can mark it. */
    errorField: "name" | "lat" | "lon" | null;
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
  confirmClear: boolean;
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
  askClearBackups(): void;
  clearBackups(): void;
  cancelClearBackups(): void;
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
  /** Clears pending confirms, shown backups and messages; call when the page is entered. */
  reset(): void;
  /**
   * Moves keyboard focus to the element requested by the last action, if any.
   * Call after each render: template swaps otherwise drop focus to the body.
   */
  applyFocus(root?: ParentNode): void;
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

const MAX_IMPORT_CHARS = 1_000_000;
const REMOVED = "That location was removed.";

/** The store throws a RangeError "No saved location …" when an id vanished. */
const storeErrorText = (e: unknown): string =>
  e instanceof RangeError && e.message.startsWith("No saved location")
    ? REMOVED
    : errorText(e);

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

  const initialState = (): ManageState => ({
    add: {
      name: "",
      lat: "",
      lon: "",
      busy: false,
      locating: false,
      message: null,
      errorField: null,
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
    confirmClear: false,
    storageMessage: null,
  });
  const state = initialState();

  // The input of the add attempt in flight or that last failed. "Save without
  // weather data" must save this, not whatever the fields hold by then.
  type AddInput = {
    name: string;
    lat: number;
    lon: number;
    text: { name: string; lat: string; lon: string };
  };
  let attempt: AddInput | null = null;
  let pendingFocus: string | null = null;
  const focusOn = (selector: string) => {
    pendingFocus = selector;
  };

  const readAddForm = (): AddInput => ({
    name: state.add.name,
    lat: parseCoord(state.add.lat, "lat"),
    lon: parseCoord(state.add.lon, "lon"),
    text: { name: state.add.name, lat: state.add.lat, lon: state.add.lon },
  });

  /** Which field a checkLocationInput message is about. */
  const fieldOf = (problem: string): "name" | "lat" | "lon" =>
    problem.startsWith("Latitude")
      ? "lat"
      : problem.startsWith("Longitude")
        ? "lon"
        : "name";

  /** Returns true when the input is acceptable; otherwise marks the field. */
  function validateAdd(input: AddInput): boolean {
    const a = state.add;
    const problem = checkLocationInput(input.name, input.lat, input.lon);
    if (problem === null) {
      a.errorField = null;
      return true;
    }
    a.message = error(problem);
    a.errorField = fieldOf(problem);
    focusOn(`#add-${a.errorField}`);
    return false;
  }

  function commitAdd(input: AddInput, nws?: NwsMeta) {
    const a = state.add;
    try {
      const { name, lat, lon } = input;
      const saved = store.add(
        nws ? { name, lat, lon, nws } : { name, lat, lon },
      );
      // Leave anything the user typed since the attempt started.
      if (a.name === input.text.name) a.name = "";
      if (a.lat === input.text.lat) a.lat = "";
      if (a.lon === input.text.lon) a.lon = "";
      attempt = null;
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

  const lookUp = (lat: number, lon: number, refresh: boolean) =>
    resolveLocation(client, lat, lon, ctx.now(), { refresh });

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
      if (state.add.errorField === field) {
        state.add.errorField = null;
        state.add.message = null;
      }
      changed();
    },

    async submitAdd() {
      const a = state.add;
      if (a.busy || a.locating) return;
      const input = readAddForm();
      a.offerSaveWithout = false;
      if (!validateAdd(input)) {
        changed();
        return;
      }
      attempt = input;
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
      if (attempt === null || state.add.busy) return;
      commitAdd(attempt);
      changed();
    },

    async useMyLocation() {
      const geolocation = ctx.geolocation;
      const a = state.add;
      if (!geolocation || a.locating || a.busy) return;
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
            a.errorField = null;
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
      if (!found || state.list.busyId === id) return;
      Object.assign(state.list, {
        renamingId: id,
        renameValue: found.name,
        renameError: null,
        deletingId: null,
      });
      focusOn(`#rename-${id}`);
      changed();
    },
    setRenameValue(value) {
      state.list.renameValue = value;
      changed();
    },
    submitRename() {
      const l = state.list;
      const id = l.renamingId;
      if (id === null) return;
      try {
        const renamed = store.rename(id, l.renameValue);
        l.renamingId = null;
        l.renameError = null;
        l.message = info(`Renamed to ${renamed.name}.`);
        focusOn(`[data-focus="rename-${id}"]`);
      } catch (e) {
        l.renameError = storeErrorText(e);
        focusOn(`#rename-${id}`);
      }
      changed();
    },
    cancelRename() {
      const id = state.list.renamingId;
      state.list.renamingId = null;
      state.list.renameError = null;
      if (id !== null) focusOn(`[data-focus="rename-${id}"]`);
      changed();
    },

    askDelete(id) {
      if (state.list.busyId === id) return;
      state.list.deletingId = id;
      state.list.renamingId = null;
      focusOn('[data-focus="delete-cancel"]');
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
        l.message = error(storeErrorText(e));
      }
      l.deletingId = null;
      focusOn("#saved-heading");
      changed();
    },
    cancelDelete() {
      const id = state.list.deletingId;
      state.list.deletingId = null;
      if (id !== null) focusOn(`[data-focus="delete-${id}"]`);
      changed();
    },

    async reresolve(id) {
      const l = state.list;
      const found = store.get(id);
      if (!found || l.busyId !== null) return;
      l.busyId = id;
      l.renamingId = l.renamingId === id ? null : l.renamingId;
      l.deletingId = l.deletingId === id ? null : l.deletingId;
      l.message = info(`Looking up ${found.name}…`);
      changed();
      try {
        const nws = await lookUp(found.lat, found.lon, true);
        // The list can change during the lookup (another tab, delete and
        // re-add under the same id); never attach this result to a different place.
        const current = store.get(id);
        if (!current) {
          l.message = error(REMOVED);
        } else if (
          current.lat !== found.lat ||
          current.lon !== found.lon ||
          current.createdAt !== found.createdAt
        ) {
          l.message = error(
            `${current.name} changed while updating — try again.`,
          );
        } else {
          store.updateMeta(id, nws);
          l.message = info(`Updated weather data for ${current.name}.`);
        }
      } catch (e) {
        l.message = error(
          e instanceof NwsError
            ? describeNwsFailure(e, OFFLINE_LOOKUP).text
            : storeErrorText(e),
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
      if (file.size > MAX_IMPORT_CHARS) {
        state.import.error =
          "That file isn't a locations backup: it is larger than 1 MB.";
        changed();
        return;
      }
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
        if (checked.ok) {
          i.confirmReplace = true;
          focusOn('[data-focus="confirm-cancel"]');
        } else {
          i.error = checked.error;
        }
      } else {
        runImport();
        return;
      }
      changed();
    },
    confirmReplace: runImport,
    cancelReplace() {
      state.import.confirmReplace = false;
      focusOn('[data-focus="import"]');
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
    askClearBackups() {
      state.confirmClear = true;
      focusOn('[data-focus="confirm-cancel"]');
      changed();
    },
    clearBackups() {
      store.clearBackups();
      state.confirmClear = false;
      state.storageMessage = info("Old backups cleared.");
      focusOn("#storage-heading");
      changed();
    },
    cancelClearBackups() {
      state.confirmClear = false;
      focusOn('[data-focus="ask-clear"]');
      changed();
    },
    askDiscard() {
      state.confirmDiscard = true;
      focusOn('[data-focus="confirm-cancel"]');
      changed();
    },
    confirmDiscard() {
      store.discardCorrupt();
      state.confirmDiscard = false;
      state.storageMessage = info("Unreadable data discarded.");
      focusOn("#storage-heading");
      changed();
    },
    cancelDiscard() {
      state.confirmDiscard = false;
      focusOn('[data-focus="ask-discard"]');
      changed();
    },
    reload,
  };

  return {
    state,
    actions,
    reset() {
      const { add, list, backup, import: imp } = state;
      add.message = null;
      add.errorField = null;
      add.offerSaveWithout = false;
      attempt = null;
      list.message = null;
      list.renamingId = null;
      list.renameError = null;
      list.deletingId = null;
      backup.message = null;
      backup.shown = null;
      imp.confirmReplace = false;
      imp.result = null;
      imp.error = null;
      state.confirmDiscard = false;
      state.confirmClear = false;
      state.storageMessage = null;
      pendingFocus = null;
    },
    applyFocus(root = document) {
      if (pendingFocus === null) return;
      const selector = pendingFocus;
      pendingFocus = null;
      root.querySelector<HTMLElement>(selector)?.focus();
    },
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
