import type { NwsClient } from "../nws/client";
import { fetchStations, resolvePoint } from "../nws/points";
import { metaFromPoint, type NwsMeta } from "../store/locations";

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
