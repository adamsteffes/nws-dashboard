import {
  type LocationStore,
  type LocationsFile,
  parseLocationsFile,
  uniqueId,
} from "./locations";

export type ValidationResult =
  | { ok: true; file: LocationsFile; warnings: string[] }
  | { ok: false; error: string };

export type ImportResult = {
  /** Locations written to the store from the file. */
  added: number;
  /** Existing locations discarded (replace mode only). */
  replaced: number;
  /** Duplicates left out (merge mode only). */
  skipped: number;
  warnings: string[];
};

const MAX_FILE_CHARS = 1_000_000;
const MAX_LOCATIONS = 500;
const PREFIX = "That file isn't a locations backup: ";

const pad = (n: number) => String(n).padStart(2, "0");

export function exportLocations(
  store: LocationStore,
  now: Date,
): { filename: string; json: string } {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const file: LocationsFile = { version: 1, locations: store.list() };
  return {
    filename: `nws-dashboard-locations-${date}.json`,
    json: JSON.stringify(file, null, 2),
  };
}

export function validateLocationsFile(input: unknown): ValidationResult {
  let raw = input;
  if (typeof input === "string") {
    if (input.length > MAX_FILE_CHARS) {
      return {
        ok: false,
        error: `${PREFIX}it is larger than 1 MB.`,
      };
    }
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, error: `${PREFIX}it isn't valid JSON.` };
    }
  }
  const list = (raw as { locations?: unknown } | null)?.locations;
  if (Array.isArray(list) && list.length > MAX_LOCATIONS) {
    return {
      ok: false,
      error: `${PREFIX}it has more than ${MAX_LOCATIONS} locations.`,
    };
  }
  const parsed = parseLocationsFile(raw, new Date().toISOString());
  if (!parsed.ok) return { ok: false, error: `${PREFIX}${parsed.reason}` };
  return {
    ok: true,
    file: { version: 1, locations: parsed.locations },
    warnings: parsed.warnings,
  };
}

/** Throws an Error with a user-readable message, leaving the store untouched, if the input is unusable. */
export function importLocations(
  store: LocationStore,
  input: unknown,
  mode: "merge" | "replace",
): ImportResult {
  const result = validateLocationsFile(input);
  if (!result.ok) throw new Error(result.error);
  const warnings = [...result.warnings];
  const incoming = result.file.locations;

  if (mode === "replace") {
    const replaced = store.list().length;
    store.replaceAll(incoming);
    return { added: incoming.length, replaced, skipped: 0, warnings };
  }

  const merged = store.list();
  const taken = new Set(merged.map((l) => l.id));
  let added = 0;
  let skipped = 0;
  for (const entry of incoming) {
    const duplicate = merged.some(
      (l) =>
        l.lat === entry.lat && l.lon === entry.lon && l.name === entry.name,
    );
    if (duplicate) {
      skipped++;
      continue;
    }
    const id = uniqueId(entry.id, taken);
    if (id !== entry.id) {
      warnings.push(
        `"${entry.name}" was given the id "${id}" because "${entry.id}" is already in use.`,
      );
    }
    taken.add(id);
    merged.push({ ...entry, id });
    added++;
  }
  store.replaceAll(merged);
  return { added, replaced: 0, skipped, warnings };
}
