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
    const match = /(?:^|[\s,])max-age=(\d+)/i.exec(cacheControl);
    if (match?.[1] !== undefined) return clamp(Number(match[1]) * 1000);
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
    this.maxEntries = options.maxEntries ?? 200;
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
    this.entries.set(key, { value, storedAt, expiresAt: storedAt + ttlMs });
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
    const promise = (async () => factory())().finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  };
}
