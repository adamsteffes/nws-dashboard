import type { NwsClient } from "../nws/client";
import { fetchStations, resolvePoint } from "../nws/points";
import {
  type LocationStore,
  metaFromPoint,
  type NwsMeta,
  type SavedLocation,
} from "../store/locations";

/** Looks up the grid, stations and radar for a coordinate. Does not touch the store. */
export async function resolveLocation(
  client: NwsClient,
  lat: number,
  lon: number,
  now: Date,
  opts: { refresh?: boolean } = {},
): Promise<NwsMeta> {
  const point = await resolvePoint(client, lat, lon, opts);
  const stations = await fetchStations(
    client,
    point.data.observationStationsUrl,
  );
  return metaFromPoint(point.data, stations.data, now);
}

/**
 * Saves looked-up metadata only if the location is still the same place.
 * The list can change during a lookup (another tab, delete and re-add under
 * the same id), and metadata for one place must never be attached to another.
 */
export function saveMetaIfUnchanged(
  store: LocationStore,
  original: SavedLocation,
  meta: NwsMeta,
): boolean {
  const current = store.get(original.id);
  if (
    !current ||
    current.lat !== original.lat ||
    current.lon !== original.lon ||
    current.createdAt !== original.createdAt
  ) {
    return false;
  }
  store.updateMeta(original.id, meta);
  return true;
}
