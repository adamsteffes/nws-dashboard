import { createNwsClient, type NwsClient } from "../nws/client";
import { createLastGood, type LastGood } from "../store/lastGood";
import { createLocationStore, type LocationStore } from "../store/locations";

/** The part of navigator.geolocation the app uses, so tests can fake it. */
export type GeolocationLike = Pick<Geolocation, "getCurrentPosition">;

/** Shared wiring created once at startup and passed to views and controllers. */
export type AppContext = {
  store: LocationStore;
  client: NwsClient;
  lastGood: LastGood;
  /** Absent when the browser has no geolocation; features hide themselves. */
  geolocation?: GeolocationLike;
  now: () => Date;
};

/**
 * Builds the context. Every part can be replaced for tests; pass
 * `geolocation: undefined` to simulate a browser without it.
 */
export function createAppContext(opts: Partial<AppContext> = {}): AppContext {
  const lastGood = opts.lastGood ?? createLastGood();
  const context: AppContext = {
    store: opts.store ?? createLocationStore(),
    client: opts.client ?? createNwsClient({ lastGood }),
    lastGood,
    now: opts.now ?? (() => new Date()),
  };
  const geolocation =
    "geolocation" in opts
      ? opts.geolocation
      : typeof navigator === "undefined"
        ? undefined
        : navigator.geolocation;
  if (geolocation) context.geolocation = geolocation;
  return context;
}
