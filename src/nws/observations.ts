import { ageMinutes } from "../util/time";
import type { Fetched, NwsClient } from "./client";
import { NwsError } from "./errors";
import { convert, degToCompass, round } from "./units";

export type Observation = {
  stationId: string;
  timestamp: string;
  textDescription: string;
  icon: string | null;
  temperatureF: number | null;
  dewpointF: number | null;
  humidity: number | null;
  windMph: number | null;
  windGustMph: number | null;
  windDirection: string | null;
  pressureInHg: number | null;
  visibilityMi: number | null;
  heatIndexF: number | null;
  windChillF: number | null;
  feelsLikeF: number | null;
};

export type LatestObservation = Fetched<Observation> & {
  usedFallback: boolean;
  ageMinutes: number | null;
  tooOld: boolean;
};

const MAX_AGE_MINUTES = 120;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const text = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

const rounded = (n: number | null, digits = 0): number | null =>
  n === null ? null : round(n, digits);

export function parseObservation(
  json: unknown,
  stationId?: string,
): Observation {
  const props =
    isRecord(json) && isRecord(json.properties) ? json.properties : {};
  const id =
    text(props.stationId) ??
    stationId ??
    text(props.station)?.split("/").filter(Boolean).pop() ??
    "";

  const temperatureF = rounded(convert(props.temperature, "degF"));
  const heatIndexF = rounded(convert(props.heatIndex, "degF"));
  const windChillF = rounded(convert(props.windChill, "degF"));
  const direction = convert(props.windDirection, "deg");

  return {
    stationId: id,
    timestamp: text(props.timestamp) ?? "",
    textDescription: text(props.textDescription) ?? "",
    icon: text(props.icon),
    temperatureF,
    dewpointF: rounded(convert(props.dewpoint, "degF")),
    humidity: rounded(convert(props.relativeHumidity, "percent")),
    windMph: rounded(convert(props.windSpeed, "mph")),
    windGustMph: rounded(convert(props.windGust, "mph")),
    windDirection: direction === null ? null : degToCompass(direction),
    pressureInHg: rounded(convert(props.barometricPressure, "inHg"), 2),
    visibilityMi: rounded(convert(props.visibility, "mi"), 1),
    heatIndexF,
    windChillF,
    feelsLikeF: heatIndexF ?? windChillF ?? temperatureF,
  };
}

export function latestObservationUrl(stationId: string): string {
  return `https://api.weather.gov/stations/${encodeURIComponent(stationId)}/observations/latest`;
}

type Candidate = {
  fetched: Fetched<Observation>;
  age: number | null;
  index: number;
};

// An unparseable timestamp counts as the oldest possible.
const staleness = (c: Candidate): number => c.age ?? Number.POSITIVE_INFINITY;

const freshest = (candidates: Candidate[]): Candidate | undefined =>
  // The sort is stable, so ties keep the earlier (closer) station.
  [...candidates].sort((a, b) => staleness(a) - staleness(b))[0];

export async function fetchLatestObservation(
  client: NwsClient,
  stationIds: string[],
  now: Date,
  opts: { refresh?: boolean } = {},
): Promise<LatestObservation> {
  if (stationIds.length === 0) throw new Error("No observation stations");

  const candidates: Candidate[] = [];
  let lastError: unknown;
  for (const [index, stationId] of stationIds.entries()) {
    let fetched: Fetched<Observation>;
    try {
      const res = await client.getJson(latestObservationUrl(stationId), opts);
      fetched = { ...res, data: parseObservation(res.data, stationId) };
    } catch (error) {
      if (!(error instanceof NwsError)) throw error;
      lastError = error;
      continue;
    }
    const age = ageMinutes(fetched.data.timestamp, now);
    if (
      fetched.data.temperatureF !== null &&
      age !== null &&
      age <= MAX_AGE_MINUTES
    ) {
      return {
        ...fetched,
        usedFallback: index > 0,
        ageMinutes: age,
        tooOld: false,
      };
    }
    candidates.push({ fetched, age, index });
  }

  // Prefer an old reading with a temperature over a recent empty one.
  const chosen =
    freshest(candidates.filter((c) => c.fetched.data.temperatureF !== null)) ??
    freshest(candidates);
  if (!chosen) throw lastError;
  return {
    ...chosen.fetched,
    usedFallback: chosen.index > 0,
    ageMinutes: chosen.age,
    tooOld: true,
  };
}
