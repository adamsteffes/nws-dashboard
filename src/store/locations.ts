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
};

export const DEFAULT_KEY = "nwsdash:locations:v1";
const MAX_NAME = 60;
const MAX_SLUG = 40;

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
  | { ok: false; reason: string };

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
    const baseId = isStr(entry.id) ? entry.id : slugify(name);
    const id = uniqueId(baseId, taken);
    if (id !== baseId && isStr(entry.id)) {
      warnings.push(
        `Entry at index ${index}: id "${baseId}" was already used, so it became "${id}".`,
      );
    }
    taken.add(id);
    const location: SavedLocation = {
      id,
      name,
      lat: roundCoord(entry.lat as number),
      lon: roundCoord(entry.lon as number),
      createdAt: isStr(entry.createdAt) ? entry.createdAt : nowIso,
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
  let persistent = storage !== undefined;
  let warned = false;
  const listeners = new Set<() => void>();

  const warnOnce = (why: string, error?: unknown) => {
    if (warned) return;
    warned = true;
    console.warn(`Saved locations won't persist: ${why}`, error ?? "");
  };

  if (storage === undefined) warnOnce("storage is unavailable.");

  function quarantine(raw: string) {
    try {
      storage?.setItem(`${key}.corrupt-${clock()}`, raw);
    } catch (error) {
      warnOnce("couldn't keep a copy of unreadable data.", error);
    }
  }

  function load() {
    corrupt = false;
    dropped = 0;
    locations = [];
    if (storage === undefined) return;
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch (error) {
      persistent = false;
      warnOnce("reading storage failed.", error);
      return;
    }
    if (raw === null) return;
    let parsed: ParsedLocations;
    try {
      parsed = parseLocationsFile(JSON.parse(raw), nowIso());
    } catch {
      parsed = { ok: false, reason: "invalid JSON" };
    }
    if (!parsed.ok) {
      // Keep the original so a later write can't destroy recoverable data.
      quarantine(raw);
      corrupt = true;
      return;
    }
    locations = parsed.locations;
    dropped = parsed.dropped;
  }

  function persist() {
    if (storage === undefined) return;
    const file: LocationsFile = { version: 1, locations };
    try {
      storage.setItem(key, JSON.stringify(file));
      persistent = true;
    } catch (error) {
      persistent = false;
      warnOnce("writing to storage failed (full or private mode?).", error);
    }
  }

  const notify = () => {
    for (const fn of [...listeners]) fn();
  };

  const commit = (next: SavedLocation[]) => {
    locations = next;
    persist();
    notify();
  };

  const find = (id: string): SavedLocation => {
    const found = locations.find((l) => l.id === id);
    if (found === undefined) throw new RangeError(`No saved location "${id}".`);
    return found;
  };

  const replaceOne = (updated: SavedLocation) =>
    commit(locations.map((l) => (l.id === updated.id ? updated : l)));

  load();

  // Another tab (same origin) wrote the data; adopt it.
  if (typeof window !== "undefined" && storage !== undefined) {
    window.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== key) return;
      load();
      notify();
    });
  }

  return {
    list: () => [...locations],
    get: (id) => locations.find((l) => l.id === id),
    add(input) {
      const problem = checkLocationInput(input.name, input.lat, input.lon);
      if (problem !== null) throw new RangeError(problem);
      const name = input.name.trim();
      const location: SavedLocation = {
        id: uniqueId(slugify(name), new Set(locations.map((l) => l.id))),
        name,
        lat: roundCoord(input.lat),
        lon: roundCoord(input.lon),
        createdAt: nowIso(),
      };
      if (input.nws !== undefined) location.nws = input.nws;
      commit([...locations, location]);
      return location;
    },
    rename(id, name) {
      const existing = find(id);
      const problem = checkLocationInput(name, existing.lat, existing.lon);
      if (problem !== null) throw new RangeError(problem);
      const updated = { ...existing, name: name.trim() };
      replaceOne(updated);
      return updated;
    },
    remove(id) {
      if (!locations.some((l) => l.id === id)) return false;
      commit(locations.filter((l) => l.id !== id));
      return true;
    },
    updateMeta(id, nws) {
      const updated = { ...find(id), nws };
      replaceOne(updated);
      return updated;
    },
    replaceAll(next) {
      const parsed = parseLocationsFile({ locations: next }, nowIso());
      if (!parsed.ok) throw new RangeError(parsed.reason);
      if (parsed.dropped > 0) {
        throw new RangeError(parsed.warnings.join(" "));
      }
      commit(parsed.locations);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
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
  };
}
