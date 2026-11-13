export const MIN_TTL_MS = 60_000;
export const MAX_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TTL_MS = 5 * 60_000;

const clamp = (ms: number) => Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ms));

function readHeader(
  headers: Headers | Record<string, string>,
  name: string,
): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

/**
 * Derives a client-side TTL from NWS response headers. s-maxage is ignored on
 * purpose: it targets shared caches, while max-age is what a browser may honor.
 */
export function ttlFromHeaders(
  headers: Headers | Record<string, string>,
  now: number,
): number {
  const cacheControl = readHeader(headers, "cache-control");
  if (cacheControl) {
    if (/(^|[\s,])(no-store|no-cache)(?=$|[\s,=])/i.test(cacheControl)) {
      return MIN_TTL_MS;
    }
    const match = /(?:^|[\s,])max-age=(?:"(\d+)"|(\d+))(?=$|[\s,;])/i.exec(
      cacheControl,
    );
    const maxAge = match?.[1] ?? match?.[2];
    if (maxAge !== undefined) {
      // A response replayed from the browser HTTP cache keeps its original
      // Date and max-age, so subtract how old it already is. Negative ages
      // (device clock behind the server) count as zero.
      const date = Date.parse(readHeader(headers, "date") ?? "");
      const sinceDate = Number.isNaN(date) ? 0 : Math.max(0, now - date);
      const ageHeader = readHeader(headers, "age")?.trim() ?? "";
      const ageMs = /^\d+$/.test(ageHeader) ? Number(ageHeader) * 1000 : 0;
      return clamp(Number(maxAge) * 1000 - sinceDate - ageMs);
    }
  }

  const expires = Date.parse(readHeader(headers, "expires") ?? "");
  if (!Number.isNaN(expires)) {
    const dateHeader = Date.parse(readHeader(headers, "date") ?? "");
    const base = Number.isNaN(dateHeader) ? now : dateHeader;
    return clamp(expires - base);
  }

  return DEFAULT_TTL_MS;
}

type Entry<T> = { value: T; storedAt: number; expiresAt: number };

export type StaleResult<T> = {
  value: T;
  storedAt: number;
  expiresAt: number;
};

export type TtlCacheOptions = {
  clock?: () => number;
  maxEntries?: number;
};

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly clock: () => number;
  private readonly maxEntries: number;

  constructor(options: TtlCacheOptions = {}) {
    this.clock = options.clock ?? Date.now;
    const max = options.maxEntries;
    this.maxEntries =
      max !== undefined && Number.isInteger(max) && max >= 1 ? max : 200;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.clock()) return undefined;
    // Re-insert so Map order tracks recency of use.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  getStale(key: string): StaleResult<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    return {
      value: entry.value,
      storedAt: entry.storedAt,
      expiresAt: entry.expiresAt,
    };
  }

  set(key: string, value: T, ttlMs: number): void {
    const storedAt = this.clock();
    this.entries.delete(key);
    const ttl = Number.isFinite(ttlMs) ? ttlMs : MIN_TTL_MS;
    this.entries.set(key, { value, storedAt, expiresAt: storedAt + ttl });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  deleteByPrefix(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export type SingleFlight = <T>(
  key: string,
  factory: () => Promise<T>,
) => Promise<T>;

/** Concurrent calls with the same key share one in-flight promise. */
export function createSingleFlight(): SingleFlight {
  const inFlight = new Map<string, Promise<unknown>>();
  return <T>(key: string, factory: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;
    let start: () => void = () => {};
    const promise: Promise<T> = new Promise<T>((resolve, reject) => {
      start = () => {
        try {
          factory().then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      };
    }).finally(() => {
      // Only remove our own entry; the key may have been reused by then.
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
    // Register before running the factory so a re-entrant call with the same
    // key during its synchronous part joins this flight instead of starting one.
    inFlight.set(key, promise);
    start();
    return promise;
  };
}
