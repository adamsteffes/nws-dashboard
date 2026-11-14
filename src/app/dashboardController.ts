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

const isUnhealthy = (s: LocationSummary): boolean =>
  [s.alerts, s.current, s.forecast].some((p) => p.status !== "ok");

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
  const inFlight = new Set<string>();
  let running = 0;
  let nextToken = 0;
  let lastUpdated: Date | null = null;
  let online = (options.isOnline ?? (() => navigator.onLine !== false))();

  async function loadOne(location: SavedLocation, refresh: boolean) {
    const id = location.id;
    const token = ++nextToken;
    tokens.set(id, token);
    inFlight.add(id);
    // Keep showing old data during a refresh; only a first load shows skeletons.
    if (!summaries.has(id)) summaries.set(id, loadingSummary());
    let summary: LocationSummary;
    try {
      summary = await loadLocationSummary(ctx, location, { refresh });
    } finally {
      if (tokens.get(id) === token) inFlight.delete(id);
    }
    if (tokens.get(id) !== token) return;
    const current = store.get(id);
    // Removed while loading.
    if (!current) return;
    summaries.set(id, summary);
    // Taken after the load: resolving metadata updates the store itself.
    loadedKeys.set(id, dataKey(current));
    changed();
  }

  async function run(work: () => Promise<unknown>) {
    running++;
    changed();
    try {
      await work();
    } finally {
      running--;
      lastUpdated = ctx.now();
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
    const stale = locations.filter(
      (l) => !inFlight.has(l.id) && loadedKeys.get(l.id) !== dataKey(l),
    );
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
      return run(() =>
        Promise.all(store.list().map((l) => loadOne(l, refresh))),
      );
    },
    setOnline(value) {
      const wasOnline = online;
      online = value;
      if (value && !wasOnline) {
        const unhealthy = store.list().filter((l) => {
          const s = summaries.get(l.id);
          return s !== undefined && isUnhealthy(s);
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
