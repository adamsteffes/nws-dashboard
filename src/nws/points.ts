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
  radarStation: string;
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
    radarStation: reqString(props, "radarStation"),
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

export async function resolvePoint(
  client: NwsClient,
  lat: number,
  lon: number,
): Promise<Fetched<PointInfo>> {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError(`Latitude out of range: ${lat}`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new RangeError(`Longitude out of range: ${lon}`);
  }
  const res = await client.getJson(pointUrl(lat, lon));
  return { ...res, data: parsePoint(res.data) };
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

export async function fetchStations(
  client: NwsClient,
  url: string,
  limit = 3,
): Promise<Fetched<string[]>> {
  const res = await client.getJson(url);
  return { ...res, data: parseStations(res.data).slice(0, limit) };
}
