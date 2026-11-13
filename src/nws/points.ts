import type { Fetched, NwsClient } from "./client";

export type PointInfo = {
  gridId: string;
  gridX: number;
  gridY: number;
  cwa: string;
  forecastUrl: string;
  forecastHourlyUrl: string;
  observationStationsUrl: string;
  forecastZone: string;
  county?: string;
  radarStation: string | null;
  timeZone: string;
  city: string;
  state: string;
};

const API_BASE = "https://api.weather.gov";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

function missing(field: string): Error {
  return new Error(`Unexpected /points response: missing ${field}`);
}

function reqString(
  obj: Record<string, unknown>,
  key: string,
  label = key,
): string {
  const value = obj[key];
  if (typeof value !== "string" || value === "") throw missing(label);
  return value;
}

function optString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function reqNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || Number.isNaN(value)) throw missing(key);
  return value;
}

/** "https://api.weather.gov/zones/forecast/KSZ009" -> "KSZ009". */
const lastSegment = (url: string): string =>
  url.split("/").filter(Boolean).pop() ?? "";

export function parsePoint(json: unknown): PointInfo {
  const props = isRecord(json) ? json.properties : undefined;
  if (!isRecord(props)) throw missing("properties");

  const relative = props.relativeLocation;
  const relativeProps = isRecord(relative) ? relative.properties : undefined;
  if (!isRecord(relativeProps)) throw missing("relativeLocation.properties");

  const forecastZone = lastSegment(reqString(props, "forecastZone"));
  if (forecastZone === "") throw missing("forecastZone");

  const info: PointInfo = {
    gridId: reqString(props, "gridId"),
    gridX: reqNumber(props, "gridX"),
    gridY: reqNumber(props, "gridY"),
    cwa: reqString(props, "cwa"),
    forecastUrl: reqString(props, "forecast"),
    forecastHourlyUrl: reqString(props, "forecastHourly"),
    observationStationsUrl: reqString(props, "observationStations"),
    forecastZone,
    // Marine and territory points can lack a radar.
    radarStation: optString(props, "radarStation"),
    timeZone: reqString(props, "timeZone"),
    city: reqString(relativeProps, "city", "relativeLocation.city"),
    state: reqString(relativeProps, "state", "relativeLocation.state"),
  };
  if (typeof props.county === "string" && props.county !== "") {
    info.county = lastSegment(props.county);
  }
  return info;
}

/** The NWS answers requests with more than 4 decimals by redirecting. */
export function roundCoord(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export function pointUrl(lat: number, lon: number): string {
  return `${API_BASE}/points/${roundCoord(lat)},${roundCoord(lon)}`;
}

export function resolvePoint(
  client: NwsClient,
  lat: number,
  lon: number,
  opts: { refresh?: boolean } = {},
): Promise<Fetched<PointInfo>> {
  // Validate the rounded values so 90.00004 is accepted as 90.
  const rLat = roundCoord(lat);
  const rLon = roundCoord(lon);
  if (!Number.isFinite(rLat) || rLat < -90 || rLat > 90) {
    return Promise.reject(new RangeError(`Latitude out of range: ${lat}`));
  }
  if (!Number.isFinite(rLon) || rLon < -180 || rLon > 180) {
    return Promise.reject(new RangeError(`Longitude out of range: ${lon}`));
  }
  return client.getJson(pointUrl(lat, lon), { ...opts, parse: parsePoint });
}

export function parseStations(json: unknown): string[] {
  const features = isRecord(json) ? json.features : undefined;
  if (!Array.isArray(features)) {
    throw new Error("Unexpected stations response: missing features");
  }
  const ids: string[] = [];
  for (const feature of features) {
    const props = isRecord(feature) ? feature.properties : undefined;
    const id = isRecord(props) ? props.stationIdentifier : undefined;
    if (typeof id === "string" && id !== "") ids.push(id);
  }
  return ids;
}

export function fetchStations(
  client: NwsClient,
  url: string,
  limit = 3,
): Promise<Fetched<string[]>> {
  // The limit is applied after the client so the cache holds the full list
  // regardless of the caller's limit.
  return client
    .getJson(url, { parse: parseStations })
    .then((res) => ({ ...res, data: res.data.slice(0, limit) }));
}
