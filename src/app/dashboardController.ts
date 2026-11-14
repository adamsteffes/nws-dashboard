import {
  type LocationSummary,
  loadingSummary,
  loadLocationSummary,
} from "../services/panels";
import type { SavedLocation } from "../store/locations";
import type { AppContext } from "./context";

export type DashboardItem = {
  location: SavedLocation;
  summary: LocationSummary;
};

export type DashboardViewProps = {
  items: DashboardItem[];
  now: Date;
};

export type DashboardController = {
  /** True while any load started by `load` is running. */
  readonly refreshing: boolean;
  readonly lastUpdated: Date | null;
  readonly online: boolean;
  load(opts?: { refresh?: boolean }): Promise<void>;
  /** Tells the controller connectivity changed; coming back online reloads unhealthy cards. */
  setOnline(online: boolean): void;
  /** True when nothing was loaded yet or the last load is older than maxAgeMs. */
  isOlderThan(maxAgeMs: number): boolean;
  viewProps(): DashboardViewProps;
};

export type DashboardControllerOptions = {
  /** Called after every state change so the caller can re-render. */
  onChange: () => void;
  isOnline?: () => boolean;
};

/** What a card's data depends on; renames and other edits don't need a reload. */
function dataKey(location: SavedLocation): string {
  const { nws } = location;
  return JSON.stringify([
    location.lat,
    location.lon,
    nws?.resolvedAt,
    nws?.forecastUrl,
    nws?.stationIds,
  ]);
}

const panelsOf = (s: LocationSummary) => [s.alerts, s.current, s.forecast];

// A panel that is still loading is already being fetched.
const needsRetry = (s: LocationSummary): boolean =>
  panelsOf(s).some((p) => p.status === "error" || p.status === "stale");

const hasData = (s: LocationSummary): boolean =>
  panelsOf(s).some((p) => p.status === "ok" || p.status === "stale");

export function createDashboardController(
  ctx: AppContext,
  options: DashboardControllerOptions,
): DashboardController {
  const { store } = ctx;
  const changed = options.onChange;
  const summaries = new Map<string, LocationSummary>();
  const loadedKeys = new Map<string, string>();
  /** Latest load per location; an older load's result is dropped. */
  const tokens = new Map<string, number>();
  /** What each running load is loading; a store change to anything else needs a new load. */
  const inFlight = new Map<string, string>();
  let running = 0;
  let nextToken = 0;
  let lastUpdated: Date | null = null;
  let online = (options.isOnline ?? (() => navigator.onLine !== false))();

  async function loadOne(
    location: SavedLocation,
    refresh: boolean,
  ): Promise<LocationSummary | null> {
    const id = location.id;
    const token = ++nextToken;
    tokens.set(id, token);
    inFlight.set(id, dataKey(location));
    // Keep showing old data during a refresh; only a first load shows skeletons.
    if (!summaries.has(id)) summaries.set(id, loadingSummary());
    let summary: LocationSummary;
    try {
      summary = await loadLocationSummary(ctx, location, {
        refresh,
        // Metadata this load resolves and saves is not a reason to start over.
        onMeta: (nws) => {
          if (tokens.get(id) === token) {
            inFlight.set(id, dataKey({ ...location, nws }));
          }
        },
      });
    } finally {
      if (tokens.get(id) === token) inFlight.delete(id);
    }
    if (tokens.get(id) !== token) return null;
    const current = store.get(id);
    // Removed, or replaced by a different place, while loading.
    if (
      !current ||
      current.lat !== location.lat ||
      current.lon !== location.lon ||
      current.createdAt !== location.createdAt
    ) {
      return null;
    }
    summaries.set(id, summary);
    loadedKeys.set(id, dataKey(current));
    changed();
    return summary;
  }

  async function run<T>(work: () => Promise<T>): Promise<T> {
    running++;
    changed();
    try {
      return await work();
    } finally {
      running--;
      changed();
    }
  }

  function forget(ids: Set<string>) {
    for (const id of [...summaries.keys()]) {
      if (ids.has(id)) continue;
      summaries.delete(id);
      loadedKeys.delete(id);
      tokens.delete(id);
      inFlight.delete(id);
    }
  }

  store.subscribe(() => {
    const locations = store.list();
    forget(new Set(locations.map((l) => l.id)));
    const stale = locations.filter((l) => {
      const key = dataKey(l);
      const pending = inFlight.get(l.id);
      return pending === undefined
        ? loadedKeys.get(l.id) !== key
        : pending !== key;
    });
    if (stale.length === 0) {
      changed();
      return;
    }
    void run(() => Promise.all(stale.map((l) => loadOne(l, false))));
  });

  return {
    get refreshing() {
      return running > 0;
    },
    get lastUpdated() {
      return lastUpdated;
    },
    get online() {
      return online;
    },
    load({ refresh = false } = {}) {
      return run(async () => {
        const results = await Promise.all(
          store.list().map((l) => loadOne(l, refresh)),
        );
        if (results.some((r) => r !== null && hasData(r))) {
          lastUpdated = ctx.now();
        }
      });
    },
    setOnline(value) {
      const wasOnline = online;
      online = value;
      if (value && !wasOnline) {
        const unhealthy = store.list().filter((l) => {
          const s = summaries.get(l.id);
          return s !== undefined && !inFlight.has(l.id) && needsRetry(s);
        });
        if (unhealthy.length > 0) {
          void run(() => Promise.all(unhealthy.map((l) => loadOne(l, true))));
          return;
        }
      }
      changed();
    },
    isOlderThan(maxAgeMs) {
      return (
        lastUpdated === null ||
        ctx.now().getTime() - lastUpdated.getTime() > maxAgeMs
      );
    },
    viewProps() {
      return {
        items: store.list().map((location) => ({
          location,
          summary: summaries.get(location.id) ?? loadingSummary(),
        })),
        now: ctx.now(),
      };
    },
  };
}
