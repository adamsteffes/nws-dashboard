import type { AppContext } from "../app/context";
import { type Alert, fetchAlerts } from "../nws/alerts";
import {
  type Forecast,
  type ForecastPeriod,
  fetchForecast,
  fetchHourly,
  nextHours,
} from "../nws/forecast";
import type { LatestObservation } from "../nws/observations";
import type { NwsMeta, SavedLocation } from "../store/locations";
import {
  describeFailure,
  fetchRetryingOnce,
  type LoadOptions,
  loadObservation,
  lookUpMeta,
  type Panel,
  settle,
} from "./panels";

export type LocationDetail = {
  alerts: Panel<Alert[]>;
  current: Panel<LatestObservation>;
  /** All periods, normally 14 half-days. */
  forecast: Panel<Forecast>;
  /** The next HOURLY_COUNT hours. */
  hourly: Panel<ForecastPeriod[]>;
};

export const HOURLY_COUNT = 48;

export function loadingDetail(): LocationDetail {
  return {
    alerts: { status: "loading" },
    current: { status: "loading" },
    forecast: { status: "loading" },
    hourly: { status: "loading" },
  };
}

/**
 * Loads everything the detail page shows for one location. Each panel
 * succeeds or fails on its own.
 */
export async function loadLocationDetail(
  ctx: AppContext,
  location: SavedLocation,
  { refresh = false, onMeta }: LoadOptions = {},
): Promise<LocationDetail> {
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
        hourly: { status: "error", error },
      };
    }
  }
  const known: NwsMeta = meta;

  // Forecast and hourly share one re-resolve when both URLs went stale.
  let reResolved: Promise<NwsMeta> | undefined;
  const reResolve = () => {
    reResolved ??= lookUpMeta(ctx, location, { refresh: true, onMeta });
    return reResolved;
  };

  const [alerts, current, forecast, hourly] = await Promise.all([
    settle(() => fetchAlerts(client, location.lat, location.lon, { refresh })),
    settle(() => loadObservation(ctx, known, refresh)),
    settle(() =>
      fetchRetryingOnce(known, reResolve, (m) =>
        fetchForecast(client, m.forecastUrl, { refresh }),
      ),
    ),
    settle(async () => {
      const fetched = await fetchRetryingOnce(known, reResolve, (m) =>
        fetchHourly(client, m.forecastHourlyUrl, { refresh }),
      );
      return {
        ...fetched,
        data: nextHours(fetched.data, ctx.now(), HOURLY_COUNT),
      };
    }),
  ]);
  return { alerts, current, forecast, hourly };
}
