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

// Rounding a small negative gives -0, which would render as "-0".
const rounded = (n: number | null, digits = 0): number | null => {
  if (n === null) return null;
  const r = round(n, digits);
  return r === 0 ? 0 : r;
};

// The API reports heat index and wind chill even when they do not apply, so
// they only count inside the ranges where the formulas are meaningful.
function feelsLike(
  temperatureF: number | null,
  heatIndexF: number | null,
  windChillF: number | null,
  windMph: number | null,
): number | null {
  if (temperatureF === null) return null;
  if (heatIndexF !== null && temperatureF >= 80) return heatIndexF;
  if (
    windChillF !== null &&
    temperatureF <= 50 &&
    windMph !== null &&
    windMph > 3
  ) {
    return windChillF;
  }
  return temperatureF;
}

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
  const windMph = rounded(convert(props.windSpeed, "mph"));
  const direction = convert(props.windDirection, "deg");

  return {
    stationId: id,
    timestamp: text(props.timestamp) ?? "",
    textDescription: text(props.textDescription) ?? "",
    icon: text(props.icon),
    temperatureF,
    dewpointF: rounded(convert(props.dewpoint, "degF")),
    humidity: rounded(convert(props.relativeHumidity, "percent")),
    windMph,
    windGustMph: rounded(convert(props.windGust, "mph")),
    // Calm wind has no meaningful direction; the UI shows "Calm".
    windDirection:
      direction === null || windMph === 0 ? null : degToCompass(direction),
    pressureInHg: rounded(convert(props.barometricPressure, "inHg"), 2),
    visibilityMi: rounded(convert(props.visibility, "mi"), 1),
    heatIndexF,
    windChillF,
    feelsLikeF: feelsLike(temperatureF, heatIndexF, windChillF, windMph),
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

  // Concurrent, so one dead station (retries and timeouts) does not delay the
  // others; the selection below still honours station order.
  const results = await Promise.allSettled(
    stationIds.map(async (stationId): Promise<Fetched<Observation>> => {
      const res = await client.getJson(latestObservationUrl(stationId), opts);
      return { ...res, data: parseObservation(res.data, stationId) };
    }),
  );

  const candidates: Candidate[] = [];
  let lastError: unknown;
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      if (!(result.reason instanceof NwsError)) throw result.reason;
      lastError = result.reason;
      continue;
    }
    const fetched = result.value;
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
  // Every station failed: surface the failure of the last one in order.
  if (!chosen) throw lastError;
  return {
    ...chosen.fetched,
    usedFallback: chosen.index > 0,
    ageMinutes: chosen.age,
    tooOld: true,
  };
}
