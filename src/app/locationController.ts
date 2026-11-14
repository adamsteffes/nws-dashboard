import {
  type LocationDetail,
  loadingDetail,
  loadLocationDetail,
} from "../services/detail";
import type { SavedLocation } from "../store/locations";
import type { AppContext } from "./context";

export type LocationViewProps = {
  /** Undefined when the id is not in the saved list. */
  location: SavedLocation | undefined;
  detail: LocationDetail;
  now: Date;
  online: boolean;
};

export type LocationController = {
  /** True while a load started by `open` or `refresh` is running. */
  readonly refreshing: boolean;
  readonly online: boolean;
  /** Shows the location and loads its data (from the client's cache when fresh). */
  open(id: string): Promise<void>;
  /** Reloads the open location, bypassing the cache. */
  refresh(): Promise<void>;
  /** Tells the controller connectivity changed; coming back online reloads unhealthy panels. */
  setOnline(online: boolean): void;
  viewProps(id: string): LocationViewProps;
};

export type LocationControllerOptions = {
  /** Called after every state change so the caller can re-render. */
  onChange: () => void;
  isOnline?: () => boolean;
};

/** What the page's data depends on; renames and other edits don't need a reload. */
function dataKey(location: SavedLocation): string {
  const { nws } = location;
  return JSON.stringify([
    location.lat,
    location.lon,
    nws?.resolvedAt,
    nws?.forecastUrl,
    nws?.forecastHourlyUrl,
    nws?.stationIds,
  ]);
}

const panelsOf = (d: LocationDetail) => [
  d.alerts,
  d.current,
  d.forecast,
  d.hourly,
];

const needsRetry = (d: LocationDetail): boolean =>
  panelsOf(d).some((p) => p.status === "error" || p.status === "stale");

export function createLocationController(
  ctx: AppContext,
  options: LocationControllerOptions,
): LocationController {
  const { store } = ctx;
  const changed = options.onChange;
  let openId: string | null = null;
  let detail: LocationDetail = loadingDetail();
  let loadedKey: string | null = null;
  /** What the running load is loading; null when idle. */
  let inFlight: string | null = null;
  let token = 0;
  let running = 0;
  let online = (options.isOnline ?? (() => navigator.onLine !== false))();

  function reset() {
    token++;
    detail = loadingDetail();
    loadedKey = null;
    inFlight = null;
  }

  async function load(id: string, refresh: boolean): Promise<void> {
    const location = store.get(id);
    if (!location) return;
    const mine = ++token;
    inFlight = dataKey(location);
    running++;
    changed();
    try {
      const result = await loadLocationDetail(ctx, location, {
        refresh,
        // Metadata this load resolves and saves is not a reason to start over.
        onMeta: (nws) => {
          if (token === mine) inFlight = dataKey({ ...location, nws });
        },
      });
      if (token !== mine) return;
      const current = store.get(id);
      // Removed, or replaced by a different place, while loading.
      if (
        !current ||
        current.lat !== location.lat ||
        current.lon !== location.lon ||
        current.createdAt !== location.createdAt
      ) {
        return;
      }
      detail = result;
      loadedKey = dataKey(current);
    } finally {
      if (token === mine) inFlight = null;
      running--;
      changed();
    }
  }

  store.subscribe(() => {
    if (openId === null) return;
    const location = store.get(openId);
    if (!location) {
      reset();
      changed();
      return;
    }
    const key = dataKey(location);
    const stale = inFlight === null ? loadedKey !== key : inFlight !== key;
    if (stale) void load(openId, false);
    else changed();
  });

  return {
    get refreshing() {
      return running > 0;
    },
    get online() {
      return online;
    },
    open(id) {
      // Keep showing the old data of the same page; another page starts empty.
      if (openId !== id) {
        openId = id;
        reset();
      }
      return load(id, false);
    },
    refresh() {
      return openId === null ? Promise.resolve() : load(openId, true);
    },
    setOnline(value) {
      const wasOnline = online;
      online = value;
      if (value && !wasOnline && openId !== null && inFlight === null) {
        if (needsRetry(detail)) {
          void load(openId, true);
          return;
        }
      }
      changed();
    },
    viewProps(id) {
      return {
        location: store.get(id),
        detail: id === openId ? detail : loadingDetail(),
        now: ctx.now(),
        online,
      };
    },
  };
}
