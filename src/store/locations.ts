import { type PointInfo, roundCoord } from "../nws/points";

export type NwsMeta = {
  resolvedAt: string;
  gridId: string;
  gridX: number;
  gridY: number;
  cwa: string;
  forecastUrl: string;
  forecastHourlyUrl: string;
  observationStationsUrl: string;
  stationIds: string[];
  radarStation: string | null;
  forecastZone: string;
  county?: string;
  timeZone: string;
  city: string;
  state: string;
};

export type SavedLocation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  createdAt: string;
  nws?: NwsMeta;
};

export type LocationsFile = { version: 1; locations: SavedLocation[] };

export type NewLocation = {
  name: string;
  lat: number;
  lon: number;
  nws?: NwsMeta;
};

/** The subset of Storage the store needs, so tests can pass tiny fakes. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type LocationStoreOptions = {
  storage?: StorageLike;
  clock?: () => number;
  key?: string;
};

export type LocationStore = {
  list(): SavedLocation[];
  get(id: string): SavedLocation | undefined;
  add(input: NewLocation): SavedLocation;
  rename(id: string, name: string): SavedLocation;
  remove(id: string): boolean;
  updateMeta(id: string, nws: NwsMeta): SavedLocation;
  replaceAll(locations: SavedLocation[]): void;
  subscribe(fn: () => void): () => void;
  /** Stored data was unreadable; a copy was kept under a .corrupt-* key. */
  readonly corrupt: boolean;
  /** Entries dropped from a partially valid stored file. */
  readonly dropped: number;
  /** False when changes only live in memory (no or failing storage). */
  readonly persistent: boolean;
  /** Changes are refused; see readOnlyReason for why. */
  readonly readOnly: boolean;
  readonly readOnlyReason: string | null;
  /** Why changes are refused, if they are. */
  readonly readOnlyKind: ReadOnlyKind | null;
  /**
   * Resumes changes after a backup couldn't be saved ("backup" or
   * "backups-full"), knowingly giving up the data that couldn't be backed up:
   * unreadable data is replaced by an empty list; for a file with dropped
   * entries the valid entries are kept and only the dropped ones are lost.
   */
  discardCorrupt(): void;
  /** Backup copies of unreadable data kept in storage, with their sizes. */
  listBackups(): { key: string; size: number }[];
  /** Deletes the backup copies; re-checks whether current data needs one. */
  clearBackups(): void;
  /**
   * Adds entries inside the same read-modify-write as any other change.
   * Entries whose id exists get a new id; identical name and coordinates are
   * skipped.
   */
  merge(incoming: SavedLocation[]): MergeResult;
};

export type ReadOnlyKind = "backup" | "backups-full" | "newer";

export type MergeResult = {
  added: number;
  skipped: number;
  warnings: string[];
};

export const DEFAULT_KEY = "nwsdash:locations:v1";
const MAX_NAME = 60;
const MAX_SLUG = 40;
/** Ids end up in URLs and DOM attributes, so keep them boring. */
const MAX_ID = 45;
const ID_PATTERN = /^[a-z0-9-]{1,45}$/;
const ISO_START = /^\d{4}-\d{2}-\d{2}T/;

export function metaFromPoint(
  point: PointInfo,
  stationIds: string[],
  now: Date,
): NwsMeta {
  const meta: NwsMeta = {
    resolvedAt: now.toISOString(),
    gridId: point.gridId,
    gridX: point.gridX,
    gridY: point.gridY,
    cwa: point.cwa,
    forecastUrl: point.forecastUrl,
    forecastHourlyUrl: point.forecastHourlyUrl,
    observationStationsUrl: point.observationStationsUrl,
    stationIds: [...stationIds],
    radarStation: point.radarStation,
    forecastZone: point.forecastZone,
    timeZone: point.timeZone,
    city: point.city,
    state: point.state,
  };
  if (point.county !== undefined) meta.county = point.county;
  return meta;
}

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    // Strip combining accents so "Zürich" becomes "zurich", not "z-rich".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
  return slug === "" ? "location" : slug;
}

/** "home", then "home-2", "home-3"... skipping ids in `taken`. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    // Trim the base so suffixed ids still satisfy the 45-character id limit.
    const trimmed = base.slice(0, MAX_ID - suffix.length).replace(/-+$/, "");
    const candidate = `${trimmed}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Returns a user-readable problem, or null when the input is acceptable. */
export function checkLocationInput(
  name: unknown,
  lat: unknown,
  lon: unknown,
): string | null {
  if (typeof name !== "string") return "Name must be text.";
  const len = name.trim().length;
  if (len < 1 || len > MAX_NAME) {
    return `Name must be 1 to ${MAX_NAME} characters.`;
  }
  if (typeof lat !== "number" || !Number.isFinite(lat)) {
    return "Latitude must be a number between -90 and 90.";
  }
  if (roundCoord(lat) < -90 || roundCoord(lat) > 90) {
    return "Latitude must be between -90 and 90.";
  }
  if (typeof lon !== "number" || !Number.isFinite(lon)) {
    return "Longitude must be a number between -180 and 180.";
  }
  if (roundCoord(lon) < -180 || roundCoord(lon) > 180) {
    return "Longitude must be between -180 and 180.";
  }
  return null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Returns a clean copy of a well-formed NwsMeta, or null. */
export function parseNwsMeta(v: unknown): NwsMeta | null {
  if (!isRecord(v)) return null;
  if (
    !isStr(v.resolvedAt) ||
    !isStr(v.gridId) ||
    !isNum(v.gridX) ||
    !isNum(v.gridY) ||
    !isStr(v.cwa) ||
    !isStr(v.forecastUrl) ||
    !isStr(v.forecastHourlyUrl) ||
    !isStr(v.observationStationsUrl) ||
    !isStr(v.forecastZone) ||
    !isStr(v.timeZone) ||
    !isStr(v.city) ||
    !isStr(v.state) ||
    !Array.isArray(v.stationIds) ||
    !v.stationIds.every(isStr) ||
    !(v.radarStation === null || isStr(v.radarStation))
  ) {
    return null;
  }
  if (v.county !== undefined && !isStr(v.county)) return null;
  const meta: NwsMeta = {
    resolvedAt: v.resolvedAt,
    gridId: v.gridId,
    gridX: v.gridX,
    gridY: v.gridY,
    cwa: v.cwa,
    forecastUrl: v.forecastUrl,
    forecastHourlyUrl: v.forecastHourlyUrl,
    observationStationsUrl: v.observationStationsUrl,
    stationIds: [...v.stationIds],
    radarStation: v.radarStation,
    forecastZone: v.forecastZone,
    timeZone: v.timeZone,
    city: v.city,
    state: v.state,
  };
  if (v.county !== undefined) meta.county = v.county;
  return meta;
}

export type ParsedLocations =
  | {
      ok: true;
      locations: SavedLocation[];
      warnings: string[];
      /** Entries dropped entirely (a dropped nws block does not count). */
      dropped: number;
    }
  | {
      ok: false;
      reason: string;
      /** Set when the file declares a version newer than this app knows. */
      newerVersion?: number;
    };

/**
 * Lenient parse shared by the store and file import. Hard failures are only
 * structural; bad entries are dropped with a warning.
 */
export function parseLocationsFile(
  raw: unknown,
  nowIso: string,
): ParsedLocations {
  if (!isRecord(raw)) return { ok: false, reason: "it isn't a JSON object." };
  if (raw.version !== undefined) {
    if (typeof raw.version !== "number" || !Number.isInteger(raw.version)) {
      return { ok: false, reason: "its version isn't a whole number." };
    }
    if (raw.version > 1) {
      return {
        ok: false,
        reason: `it uses format version ${raw.version}, but this app only understands version 1. Update the app and try again.`,
        newerVersion: raw.version,
      };
    }
    if (raw.version < 1) {
      return { ok: false, reason: `its version (${raw.version}) is invalid.` };
    }
  }
  if (!Array.isArray(raw.locations)) {
    return { ok: false, reason: 'it has no "locations" list.' };
  }

  const warnings: string[] = [];
  const locations: SavedLocation[] = [];
  const taken = new Set<string>();
  let dropped = 0;

  for (const [index, entry] of raw.locations.entries()) {
    const skip = (why: string) => {
      dropped++;
      warnings.push(`Skipped entry at index ${index}: ${why}`);
    };
    if (!isRecord(entry)) {
      skip("it isn't an object.");
      continue;
    }
    const problem = checkLocationInput(entry.name, entry.lat, entry.lon);
    if (problem !== null) {
      skip(problem);
      continue;
    }
    const name = (entry.name as string).trim();
    const givenId = entry.id;
    const validId = typeof givenId === "string" && ID_PATTERN.test(givenId);
    const baseId = validId ? givenId : slugify(name);
    const id = uniqueId(baseId, taken);
    if (givenId !== undefined && id !== givenId) {
      warnings.push(
        validId
          ? `Entry at index ${index}: id "${givenId}" was already used, so it became "${id}".`
          : `Entry at index ${index} ("${name}"): its id wasn't usable, so it became "${id}".`,
      );
    }
    taken.add(id);
    const location: SavedLocation = {
      id,
      name,
      lat: roundCoord(entry.lat as number),
      lon: roundCoord(entry.lon as number),
      createdAt:
        isStr(entry.createdAt) &&
        ISO_START.test(entry.createdAt) &&
        !Number.isNaN(Date.parse(entry.createdAt))
          ? entry.createdAt
          : nowIso,
    };
    if (entry.nws !== undefined) {
      const nws = parseNwsMeta(entry.nws);
      if (nws === null) {
        warnings.push(
          `Entry at index ${index} ("${name}"): the cached NWS data was malformed and was ignored; it will be looked up again.`,
        );
      } else {
        location.nws = nws;
      }
    }
    locations.push(location);
  }
  return { ok: true, locations, warnings, dropped };
}

function defaultStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    // Safari throws on access when storage is blocked.
    return undefined;
  }
}

const SAVE_FAILED =
  "Couldn't save — storage is full or unavailable. Your change was not kept.";
const BACKUP_FAILED =
  "Your saved locations couldn't be backed up, so changes are paused to avoid losing them. Free up browser storage and reload, or discard the unreadable data.";
const BACKUPS_FULL =
  "Too many saved backups of unreadable data are stored, so changes are paused to avoid losing more. Export or clear the old backups to continue.";
const NEWER_VERSION =
  "Your saved locations were saved by a newer version of this app, so changes are paused — reload to update.";
const MAX_BACKUPS = 3;

const copyLocation = (l: SavedLocation): SavedLocation => {
  const copy = { ...l };
  if (l.nws !== undefined) {
    copy.nws = { ...l.nws, stationIds: [...l.nws.stationIds] };
  }
  return copy;
};

export function createLocationStore(
  options: LocationStoreOptions = {},
): LocationStore {
  const clock = options.clock ?? Date.now;
  const key = options.key ?? DEFAULT_KEY;
  const storage = "storage" in options ? options.storage : defaultStorage();
  const nowIso = () => new Date(clock()).toISOString();
  const backupKeys = Array.from({ length: MAX_BACKUPS }, (_, i) =>
    i === 0 ? `${key}.corrupt` : `${key}.corrupt-${i + 1}`,
  );

  let locations: SavedLocation[] = [];
  let corrupt = false;
  let dropped = 0;
  // In-memory mode: storage is missing or unusable and there is nothing on
  // disk to protect, so changes live in memory and never count as failures.
  let memoryOnly = storage === undefined;
  let persistent = !memoryOnly;
  let readOnlyKind: ReadOnlyKind | null = null;
  // The raw string last read from or written to `key`, to spot other tabs.
  let lastRaw: string | null = null;
  let warned = false;
  const listeners = new Set<() => void>();

  const warnOnce = (why: string, error?: unknown) => {
    if (warned) return;
    warned = true;
    console.warn(`Saved locations won't persist: ${why}`, error ?? "");
  };

  if (memoryOnly) warnOnce("storage is unavailable.");

  /**
   * Keeps a copy of data we are about to stop treating as authoritative, in
   * the first free backup slot. "full" means every slot holds different data.
   */
  function backup(raw: string): "ok" | "full" | "failed" {
    if (storage === undefined) return "failed";
    try {
      for (const slot of backupKeys) {
        const existing = storage.getItem(slot);
        if (existing === raw) return "ok";
        if (existing === null) {
          storage.setItem(slot, raw);
          return "ok";
        }
      }
      return "full";
    } catch (error) {
      console.warn("Couldn't back up unreadable saved locations", error);
      return "failed";
    }
  }

  function protect(raw: string) {
    const result = backup(raw);
    if (result === "full") readOnlyKind = "backups-full";
    else if (result === "failed") readOnlyKind = "backup";
  }

  function load() {
    corrupt = false;
    dropped = 0;
    locations = [];
    readOnlyKind = null;
    if (storage === undefined) return;
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch (error) {
      memoryOnly = true;
      persistent = false;
      warnOnce("reading storage failed.", error);
      return;
    }
    lastRaw = raw;
    if (raw === null) return;

    let json: unknown;
    let parsed: ParsedLocations;
    try {
      json = JSON.parse(raw);
      parsed = parseLocationsFile(json, nowIso());
    } catch {
      parsed = { ok: false, reason: "invalid JSON" };
    }

    if (!parsed.ok && parsed.newerVersion !== undefined) {
      // Never touch data from a newer app; show what we can understand.
      readOnlyKind = "newer";
      const lenient = parseLocationsFile(
        { ...(json as object), version: 1 },
        nowIso(),
      );
      if (lenient.ok) locations = lenient.locations;
      return;
    }
    if (!parsed.ok) {
      corrupt = true;
      protect(raw);
      return;
    }
    locations = parsed.locations;
    dropped = parsed.dropped;
    // The next write would silently erase the entries we dropped.
    if (dropped > 0) protect(raw);
  }

  const readOnlyReason = (): string | null =>
    readOnlyKind === "newer"
      ? NEWER_VERSION
      : readOnlyKind === "backup"
        ? BACKUP_FAILED
        : readOnlyKind === "backups-full"
          ? BACKUPS_FULL
          : null;

  /**
   * Listeners run synchronously in subscription order, each isolated from the
   * others' errors. They should read the store's current state rather than
   * rely on call order: a listener that changes the store triggers a nested
   * notify, so later listeners may see newer state and be called again.
   */
  function notify() {
    for (const fn of [...listeners]) {
      if (!listeners.has(fn)) continue;
      try {
        fn();
      } catch (error) {
        console.error("Location store listener failed", error);
      }
    }
  }

  /** Adopts data written by another tab. Returns whether anything changed. */
  function refresh(): boolean {
    if (storage === undefined || memoryOnly) return false;
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      return false;
    }
    if (raw === lastRaw) return false;
    load();
    return true;
  }

  function persist(): boolean {
    if (memoryOnly || storage === undefined) return true;
    const file: LocationsFile = { version: 1, locations };
    const raw = JSON.stringify(file);
    try {
      storage.setItem(key, raw);
      lastRaw = raw;
      persistent = true;
      return true;
    } catch (error) {
      persistent = false;
      warnOnce("writing to storage failed (full or private mode?).", error);
      if (lastRaw !== null) return false;
      // Nothing on disk to protect (e.g. Safari private mode): keep going in
      // memory rather than refusing every change.
      memoryOnly = true;
      return true;
    }
  }

  const assertWritable = () => {
    const reason = readOnlyReason();
    if (reason !== null) throw new Error(reason);
  };

  /**
   * Applies a change to the freshest data and saves it. The callback may
   * return null for "nothing to do". If saving fails the previous list is
   * restored so memory never disagrees with storage.
   */
  function mutate(
    change: (current: SavedLocation[]) => SavedLocation[] | null,
  ) {
    assertWritable();
    if (refresh()) {
      notify();
      assertWritable();
    }
    const previous = locations;
    const next = change(previous);
    if (next === null) return;
    locations = next;
    if (!persist()) {
      locations = previous;
      throw new Error(SAVE_FAILED);
    }
    notify();
  }

  const requireIn = (list: SavedLocation[], id: string): SavedLocation => {
    const found = list.find((l) => l.id === id);
    if (found === undefined) throw new RangeError(`No saved location "${id}".`);
    return found;
  };

  const cleanMeta = (nws: unknown): NwsMeta => {
    const meta = parseNwsMeta(nws);
    if (meta === null) throw new RangeError("The NWS data is malformed.");
    return meta;
  };

  load();

  // Another tab (same origin) wrote the data; adopt it.
  if (typeof window !== "undefined" && storage !== undefined) {
    window.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== key) return;
      if (memoryOnly) {
        console.warn(
          "Ignoring a storage change from another tab to keep unsaved locations",
        );
        return;
      }
      if (refresh()) notify();
    });
  }

  return {
    list: () => locations.map(copyLocation),
    get(id) {
      const found = locations.find((l) => l.id === id);
      return found === undefined ? undefined : copyLocation(found);
    },
    add(input) {
      const problem = checkLocationInput(input.name, input.lat, input.lon);
      if (problem !== null) throw new RangeError(problem);
      const nws = input.nws === undefined ? undefined : cleanMeta(input.nws);
      const name = input.name.trim();
      let added: SavedLocation | undefined;
      mutate((current) => {
        const location: SavedLocation = {
          id: uniqueId(slugify(name), new Set(current.map((l) => l.id))),
          name,
          lat: roundCoord(input.lat),
          lon: roundCoord(input.lon),
          createdAt: nowIso(),
        };
        if (nws !== undefined) location.nws = nws;
        added = location;
        return [...current, location];
      });
      return copyLocation(added as SavedLocation);
    },
    rename(id, name) {
      // Coordinates are irrelevant here; only the name is being checked.
      const problem = checkLocationInput(name, 0, 0);
      if (problem !== null) throw new RangeError(problem);
      let updated: SavedLocation | undefined;
      mutate((current) => {
        updated = { ...requireIn(current, id), name: name.trim() };
        return current.map((l) =>
          l.id === id ? (updated as SavedLocation) : l,
        );
      });
      return copyLocation(updated as SavedLocation);
    },
    remove(id) {
      let removed = false;
      mutate((current) => {
        if (!current.some((l) => l.id === id)) return null;
        removed = true;
        return current.filter((l) => l.id !== id);
      });
      return removed;
    },
    updateMeta(id, nws) {
      const meta = cleanMeta(nws);
      let updated: SavedLocation | undefined;
      mutate((current) => {
        updated = { ...requireIn(current, id), nws: meta };
        return current.map((l) =>
          l.id === id ? (updated as SavedLocation) : l,
        );
      });
      return copyLocation(updated as SavedLocation);
    },
    replaceAll(next) {
      const parsed = parseLocationsFile({ locations: next }, nowIso());
      if (!parsed.ok) throw new RangeError(parsed.reason);
      if (parsed.dropped > 0) {
        throw new RangeError(parsed.warnings.join(" "));
      }
      mutate(() => parsed.locations);
    },
    merge(incoming) {
      const parsed = parseLocationsFile({ locations: incoming }, nowIso());
      if (!parsed.ok) throw new RangeError(parsed.reason);
      const result: MergeResult = { added: 0, skipped: 0, warnings: [] };
      mutate((current) => {
        // Reset so a retry after a refresh doesn't double count.
        result.added = 0;
        result.skipped = 0;
        result.warnings = [];
        const merged = [...current];
        const taken = new Set(merged.map((l) => l.id));
        for (const entry of parsed.locations) {
          const duplicate = merged.some(
            (l) =>
              l.lat === entry.lat &&
              l.lon === entry.lon &&
              l.name === entry.name,
          );
          if (duplicate) {
            result.skipped++;
            continue;
          }
          const id = uniqueId(entry.id, taken);
          if (id !== entry.id) {
            result.warnings.push(
              `"${entry.name}" was given the id "${id}" because "${entry.id}" is already in use.`,
            );
          }
          taken.add(id);
          merged.push({ ...entry, id });
          result.added++;
        }
        return merged;
      });
      return result;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    discardCorrupt() {
      if (readOnlyKind !== "backup" && readOnlyKind !== "backups-full") return;
      readOnlyKind = null;
      // Unreadable data has nothing to keep; with dropped entries the valid
      // ones are already in the list and only the dropped ones are given up.
      if (corrupt) locations = [];
      corrupt = false;
      notify();
    },
    listBackups() {
      if (storage === undefined) return [];
      const found: { key: string; size: number }[] = [];
      for (const slot of backupKeys) {
        try {
          const value = storage.getItem(slot);
          if (value !== null) found.push({ key: slot, size: value.length });
        } catch {
          // Unreadable slot: leave it out.
        }
      }
      return found;
    },
    clearBackups() {
      if (storage === undefined) return;
      for (const slot of backupKeys) {
        try {
          storage.removeItem(slot);
        } catch {
          // Nothing more we can do for this slot.
        }
      }
      // The current data's own backup may just have been removed; redo it, or
      // pause again, before anything can overwrite the main key.
      if (corrupt || dropped > 0) {
        load();
        notify();
      }
    },
    get corrupt() {
      return corrupt;
    },
    get dropped() {
      return dropped;
    },
    get persistent() {
      return persistent;
    },
    get readOnly() {
      return readOnlyKind !== null;
    },
    get readOnlyKind() {
      return readOnlyKind;
    },
    get readOnlyReason() {
      return readOnlyReason();
    },
  };
}
