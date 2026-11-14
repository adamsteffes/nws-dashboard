import type { AppContext } from "../app/context";
import { type Alert, fetchAlerts } from "../nws/alerts";
import { NwsError, NwsNotFound, NwsOfflineError } from "../nws/errors";
import { type ForecastPeriod, fetchForecast } from "../nws/forecast";
import {
  fetchLatestObservation,
  type LatestObservation,
} from "../nws/observations";
import type { NwsMeta, SavedLocation } from "../store/locations";
import { resolveLocation, saveMetaIfUnchanged } from "./resolveLocation";

/** One independently loading part of a dashboard card. */
export type Panel<T> = {
  status: "loading" | "ok" | "stale" | "error";
  data?: T;
  fetchedAt?: string;
  /** Short message safe to show to the user; set when status is "error". */
  error?: string;
};

export type LocationSummary = {
  alerts: Panel<Alert[]>;
  current: Panel<LatestObservation>;
  /** The next two forecast periods. */
  forecast: Panel<ForecastPeriod[]>;
};

export type LoadOptions = {
  refresh?: boolean;
  /** Called with metadata this load resolved, just before it is saved to the store. */
  onMeta?: (meta: NwsMeta) => void;
};

export const FORECAST_PERIODS = 2;

const OFFLINE_MESSAGE = "Offline — no saved data yet";
const SERVICE_MESSAGE = "Weather Service unavailable";
const PARSE_MESSAGE = "Unexpected response";
const NO_STATIONS_MESSAGE = "No nearby weather stations";

class NoStationsError extends Error {}

export function loadingSummary(): LocationSummary {
  return {
    alerts: { status: "loading" },
    current: { status: "loading" },
    forecast: { status: "loading" },
  };
}

export function describeFailure(e: unknown): string {
  if (e instanceof NoStationsError) return NO_STATIONS_MESSAGE;
  if (e instanceof NwsOfflineError) return OFFLINE_MESSAGE;
  // The service answered, but the body failed validation.
  if (e instanceof NwsError && e.status >= 200 && e.status < 300) {
    return PARSE_MESSAGE;
  }
  if (e instanceof NwsError) return SERVICE_MESSAGE;
  return PARSE_MESSAGE;
}

type Loaded<T> = { data: T; fetchedAt: string; stale: boolean };

async function settle<T>(work: () => Promise<Loaded<T>>): Promise<Panel<T>> {
  try {
    const { data, fetchedAt, stale } = await work();
    return { status: stale ? "stale" : "ok", data, fetchedAt };
  } catch (e) {
    return { status: "error", error: describeFailure(e) };
  }
}

async function lookUpMeta(
  ctx: AppContext,
  location: SavedLocation,
  {
    refresh,
    onMeta,
  }: Required<Pick<LoadOptions, "refresh">> & Pick<LoadOptions, "onMeta">,
): Promise<NwsMeta> {
  const meta = await resolveLocation(
    ctx.client,
    location.lat,
    location.lon,
    ctx.now(),
    { refresh },
  );
  onMeta?.(meta);
  try {
    saveMetaIfUnchanged(ctx.store, location, meta);
  } catch {
    // Storage is read-only; this load can still use the meta.
  }
  return meta;
}

/**
 * Loads alerts, the latest observation and the forecast for one location.
 * Each panel succeeds or fails on its own.
 */
export async function loadLocationSummary(
  ctx: AppContext,
  location: SavedLocation,
  { refresh = false, onMeta }: LoadOptions = {},
): Promise<LocationSummary> {
  const { client } = ctx;
  let meta = location.nws;
  if (!meta) {
    try {
      meta = await lookUpMeta(ctx, location, { refresh, onMeta });
    } catch (e) {
      const error = describeFailure(e);
      return {
        alerts: { status: "error", error },
        current: { status: "error", error },
        forecast: { status: "error", error },
      };
    }
  }
  const known: NwsMeta = meta;

  const forecast = async () => {
    try {
      return await fetchForecast(client, known.forecastUrl, { refresh });
    } catch (e) {
      // The grid cell moved or was retired. Re-resolve once; a second 404 is final.
      if (!(e instanceof NwsNotFound)) throw e;
      const next = await lookUpMeta(ctx, location, {
        refresh: true,
        onMeta,
      });
      return fetchForecast(client, next.forecastUrl, { refresh });
    }
  };

  const [alerts, current, forecastPanel] = await Promise.all([
    settle(() => fetchAlerts(client, location.lat, location.lon, { refresh })),
    settle(async () => {
      if (known.stationIds.length === 0) throw new NoStationsError();
      const latest = await fetchLatestObservation(
        client,
        known.stationIds,
        ctx.now(),
        { refresh },
      );
      return { data: latest, fetchedAt: latest.fetchedAt, stale: latest.stale };
    }),
    settle(async () => {
      const fetched = await forecast();
      return {
        ...fetched,
        data: fetched.data.periods.slice(0, FORECAST_PERIODS),
      };
    }),
  ]);
  return { alerts, current, forecast: forecastPanel };
}
