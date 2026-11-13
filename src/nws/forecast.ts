import type { Fetched, NwsClient } from "./client";
import { cToF, qv, round } from "./units";

export type ForecastPeriod = {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number | null;
  temperatureTrend: string | null;
  precipChance: number | null;
  windSpeed: string;
  windDirection: string;
  icon: string | null;
  shortForecast: string;
  detailedForecast: string;
};

export type Forecast = {
  updated: string | null;
  generatedAt: string | null;
  periods: ForecastPeriod[];
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const strOr = (v: unknown, fallback: string): string =>
  typeof v === "string" ? v : fallback;

const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

function temperatureF(period: Record<string, unknown>): number | null {
  const t = period.temperature;
  if (typeof t !== "number" || Number.isNaN(t)) return null;
  return period.temperatureUnit === "C" ? round(cToF(t)) : t;
}

function parsePeriod(raw: unknown, index: number): ForecastPeriod | undefined {
  if (!isRecord(raw)) return undefined;
  const startTime = strOrNull(raw.startTime);
  if (!startTime) return undefined;
  return {
    number: typeof raw.number === "number" ? raw.number : index + 1,
    name: strOr(raw.name, ""),
    startTime,
    endTime: strOr(raw.endTime, startTime),
    isDaytime: raw.isDaytime === true,
    temperature: temperatureF(raw),
    temperatureTrend: strOrNull(raw.temperatureTrend),
    precipChance: qv(raw.probabilityOfPrecipitation)?.value ?? null,
    windSpeed: strOr(raw.windSpeed, ""),
    windDirection: strOr(raw.windDirection, ""),
    icon: strOrNull(raw.icon),
    shortForecast: strOr(raw.shortForecast, ""),
    detailedForecast: strOr(raw.detailedForecast, ""),
  };
}

export function parseForecast(json: unknown): Forecast {
  const props = isRecord(json) ? json.properties : undefined;
  if (!isRecord(props) || !Array.isArray(props.periods)) {
    throw new Error("Unexpected forecast response: missing periods");
  }
  const periods: ForecastPeriod[] = [];
  props.periods.forEach((raw, index) => {
    const period = parsePeriod(raw, index);
    if (period) periods.push(period);
  });
  return {
    updated: strOrNull(props.updateTime) ?? strOrNull(props.updated),
    generatedAt: strOrNull(props.generatedAt),
    periods,
  };
}

export async function fetchForecast(
  client: NwsClient,
  url: string,
  opts: { refresh?: boolean } = {},
): Promise<Fetched<Forecast>> {
  const res = await client.getJson(url, opts);
  return { ...res, data: parseForecast(res.data) };
}

export async function fetchHourly(
  client: NwsClient,
  url: string,
  opts: { refresh?: boolean } = {},
): Promise<Fetched<Forecast>> {
  return fetchForecast(client, url, opts);
}

/** Periods that have not ended yet, soonest first. */
export function nextHours(
  forecast: Forecast,
  now: Date,
  hours = 48,
): ForecastPeriod[] {
  const t = now.getTime();
  return forecast.periods
    .filter((p) => Date.parse(p.endTime) > t)
    .slice(0, hours);
}
