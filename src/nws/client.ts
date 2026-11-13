import { createLastGood, type LastGood } from "../store/lastGood";
import { createLimiter } from "../util/limiter";
import { createSingleFlight, TtlCache, ttlFromHeaders } from "./cache";
import {
  NwsError,
  NwsNotFound,
  NwsOfflineError,
  type ProblemDetails,
  parseProblem,
} from "./errors";

export type Fetched<T> = { data: T; fetchedAt: string; stale: boolean };

export type NwsClientOptions = {
  fetchFn?: typeof fetch;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  lastGood?: LastGood;
  isOnline?: () => boolean;
  maxConcurrent?: number;
  timeoutMs?: number;
  maxAttempts?: number;
};

export type NwsClient = {
  getJson<T = unknown>(
    url: string,
    opts?: { refresh?: boolean },
  ): Promise<Fetched<T>>;
  clear(): void;
  forget(prefix: string): Promise<void>;
};

const BASE_DELAY_MS = 500;
const MAX_RETRY_AFTER_MS = 5000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(header: string | null, now: number): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  const ms = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isNaN(ms) ? undefined : Math.max(0, ms);
}

const isTimeout = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "AbortError" || error.name === "TimeoutError");

async function problemFrom(res: Response): Promise<ProblemDetails> {
  try {
    return parseProblem(JSON.parse(await res.text()));
  } catch {
    return {};
  }
}

export function createNwsClient(opts: NwsClientOptions = {}): NwsClient {
  const fetchFn = opts.fetchFn ?? ((...args) => globalThis.fetch(...args));
  const clock = opts.clock ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const lastGood = opts.lastGood ?? createLastGood();
  const isOnline = opts.isOnline ?? (() => navigator.onLine !== false);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxAttempts = opts.maxAttempts ?? 3;

  const limiter = createLimiter(opts.maxConcurrent ?? 4);
  const singleFlight = createSingleFlight();
  const memory = new TtlCache<Fetched<unknown>>({ clock });

  async function fallback<T>(url: string): Promise<Fetched<T> | undefined> {
    const mem = memory.getStale(url);
    if (mem) return { ...(mem.value as Fetched<T>), stale: true };
    const stored = await lastGood.get<T>(url);
    if (!stored) return undefined;
    return { data: stored.value, fetchedAt: stored.fetchedAt, stale: true };
  }

  // The limiter wraps a single attempt, so backoff sleeps do not hold a slot.
  const attempt = (url: string, refresh: boolean) =>
    limiter(() =>
      fetchFn(url, {
        headers: { Accept: "application/geo+json" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: refresh ? "no-cache" : "default",
        mode: "cors",
      }),
    );

  async function download<T>(
    url: string,
    refresh: boolean,
  ): Promise<Fetched<T>> {
    let failure: NwsError | undefined;
    for (let n = 1; n <= maxAttempts; n++) {
      let delay = BASE_DELAY_MS * 2 ** (n - 1);
      let retryable: boolean;
      try {
        const res = await attempt(url, refresh);
        if (res.ok) {
          let data: T;
          try {
            data = (await res.json()) as T;
          } catch (error) {
            failure = new NwsError("Invalid JSON", res.status, url, {
              title: "Invalid JSON",
              cause: error,
            });
            break;
          }
          const ttl = ttlFromHeaders(res.headers, clock());
          const fetched: Fetched<T> = {
            data,
            fetchedAt: new Date(clock()).toISOString(),
            stale: false,
          };
          memory.set(url, fetched, ttl);
          void lastGood.put(url, data, ttl).catch(() => {});
          return fetched;
        }
        const problem = await problemFrom(res);
        if (res.status === 404) throw new NwsNotFound(url, problem);
        failure = new NwsError(
          problem.title ?? `HTTP ${res.status}`,
          res.status,
          url,
          problem,
        );
        retryable = RETRYABLE_STATUSES.has(res.status);
        const hinted = retryAfterMs(res.headers.get("retry-after"), clock());
        if (hinted !== undefined) delay = Math.min(hinted, MAX_RETRY_AFTER_MS);
      } catch (error) {
        if (error instanceof NwsNotFound) throw error;
        const timedOut = isTimeout(error);
        failure = new NwsError(
          timedOut ? "Request timed out" : "Network error",
          0,
          url,
          { title: timedOut ? "Timeout" : "Network error", cause: error },
        );
        retryable = timedOut || error instanceof TypeError;
      }
      if (!retryable || n === maxAttempts) break;
      await sleep(delay);
    }

    const old = await fallback<T>(url);
    if (old) return old;
    // Every path out of the loop records a failure first (maxAttempts >= 1).
    throw failure ?? new NwsError("No attempts made", 0, url);
  }

  return {
    async getJson<T = unknown>(
      url: string,
      options: { refresh?: boolean } = {},
    ): Promise<Fetched<T>> {
      const refresh = options.refresh === true;
      if (!refresh) {
        const hit = memory.get(url);
        if (hit) return hit as Fetched<T>;
      }
      if (!isOnline()) {
        const old = await fallback<T>(url);
        if (old) return old;
        throw new NwsOfflineError(url);
      }
      return singleFlight(url, () => download<T>(url, refresh));
    },
    clear() {
      memory.clear();
    },
    async forget(prefix: string) {
      memory.deleteByPrefix(prefix);
      await lastGood.deleteByPrefix(prefix);
    },
  };
}
