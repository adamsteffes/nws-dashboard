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
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

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
  /**
   * Gives up on unreadable data whose backup couldn't be saved, so the store
   * accepts changes again (the next change overwrites it).
   */
  discardCorrupt(): void;
};

export const DEFAULT_KEY = "nwsdash:locations:v1";
const MAX_NAME = 60;
const MAX_SLUG = 40;
/** Ids end up in URLs and DOM attributes, so keep them boring. */
const ID_PATTERN = /^[a-z0-9-]{1,45}$/;

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
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
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
        isStr(entry.createdAt) && !Number.isNaN(Date.parse(entry.createdAt))
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

  let locations: SavedLocation[] = [];
  let corrupt = false;
  let dropped = 0;
  // In-memory mode: storage is missing or unreadable from the start, so
  // changes are kept in memory only and never reported as failures.
  let memoryOnly = storage === undefined;
  let persistent = !memoryOnly;
  let readOnlyKind: "backup" | "newer" | null = null;
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
   * Keeps a copy of data we are about to stop treating as authoritative.
   * Uses `${key}.corrupt`, then `-2` and `-3` when an earlier, different copy
   * is already there. Returns false if no copy could be guaranteed.
   */
  function backup(raw: string): boolean {
    if (storage === undefined) return false;
    try {
      for (let n = 1; n <= MAX_BACKUPS; n++) {
        const slot = n === 1 ? `${key}.corrupt` : `${key}.corrupt-${n}`;
        const existing = storage.getItem(slot);
        if (existing === raw) return true;
        if (existing === null) {
          storage.setItem(slot, raw);
          return true;
        }
      }
    } catch (error) {
      console.warn("Couldn't back up unreadable saved locations", error);
    }
    return false;
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
      if (!backup(raw)) readOnlyKind = "backup";
      return;
    }
    locations = parsed.locations;
    dropped = parsed.dropped;
    // The next write would silently erase the entries we dropped.
    if (dropped > 0 && !backup(raw)) readOnlyKind = "backup";
  }

  const readOnlyReason = (): string | null =>
    readOnlyKind === "newer"
      ? NEWER_VERSION
      : readOnlyKind === "backup"
        ? BACKUP_FAILED
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
      return false;
    }
  }

  const assertWritable = () => {
    const reason = readOnlyReason();
    if (reason !== null) throw new Error(reason);
  };

  /**
   * Applies a change to the freshest data and saves it. If saving fails the
   * previous list is restored so memory never disagrees with storage.
   */
  function mutate(change: (current: SavedLocation[]) => SavedLocation[]) {
    assertWritable();
    if (refresh()) {
      notify();
      assertWritable();
    }
    const previous = locations;
    locations = change(previous);
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
      const existing = requireIn(locations, id);
      const problem = checkLocationInput(name, existing.lat, existing.lon);
      if (problem !== null) throw new RangeError(problem);
      let updated: SavedLocation | undefined;
      mutate((current) => {
        const target = requireIn(current, id);
        updated = { ...target, name: name.trim() };
        return current.map((l) =>
          l.id === id ? (updated as SavedLocation) : l,
        );
      });
      return copyLocation(updated as SavedLocation);
    },
    remove(id) {
      if (!locations.some((l) => l.id === id)) return false;
      let removed = false;
      mutate((current) => {
        removed = current.some((l) => l.id === id);
        return current.filter((l) => l.id !== id);
      });
      return removed;
    },
    updateMeta(id, nws) {
      const meta = cleanMeta(nws);
      let updated: SavedLocation | undefined;
      mutate((current) => {
        const target = requireIn(current, id);
        updated = { ...target, nws: meta };
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
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    discardCorrupt() {
      if (readOnlyKind !== "backup") return;
      readOnlyKind = null;
      corrupt = false;
      dropped = 0;
      locations = [];
      notify();
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
    get readOnlyReason() {
      return readOnlyReason();
    },
  };
}
