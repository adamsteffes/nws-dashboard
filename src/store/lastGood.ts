import { clear, createStore, del, entries, get, set } from "idb-keyval";

export type LastGoodEntry<T> = {
  value: T;
  fetchedAt: string;
  expiresAt: string;
};

type Store = ReturnType<typeof createStore>;

export type LastGoodOptions = {
  clock?: () => number;
  maxEntries?: number;
  store?: Store;
};

export type LastGood = {
  get<T>(key: string): Promise<LastGoodEntry<T> | undefined>;
  put<T>(key: string, value: T, ttlMs: number): Promise<void>;
  prune(): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
  clear(): Promise<void>;
};

export function createLastGood(options: LastGoodOptions = {}): LastGood {
  const clock = options.clock ?? Date.now;
  const maxEntries = options.maxEntries ?? 100;
  // Opened lazily so importing this module never touches IndexedDB.
  let store = options.store;
  const getStore = (): Store => {
    store ??= createStore("nws-dashboard", "last-good");
    return store;
  };

  // Storage can be unavailable or evicted (private mode, iPad pressure), so
  // failures degrade to "no last-good data" rather than breaking the caller.
  async function guard<R>(
    action: string,
    fallback: R,
    fn: () => Promise<R>,
  ): Promise<R> {
    try {
      return await fn();
    } catch (error) {
      console.warn(`last-good ${action} failed`, error);
      return fallback;
    }
  }

  async function pruneInner(): Promise<void> {
    const s = getStore();
    const all = (await entries(s)) as [IDBValidKey, LastGoodEntry<unknown>][];
    const excess = all.length - maxEntries;
    if (excess <= 0) return;
    all.sort((a, b) => Date.parse(a[1].fetchedAt) - Date.parse(b[1].fetchedAt));
    await Promise.all(all.slice(0, excess).map(([key]) => del(key, s)));
  }

  return {
    get<T>(key: string) {
      return guard("get", undefined, () =>
        get<LastGoodEntry<T>>(key, getStore()),
      );
    },
    put<T>(key: string, value: T, ttlMs: number) {
      return guard("put", undefined, async () => {
        const now = clock();
        const entry: LastGoodEntry<T> = {
          value,
          fetchedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + ttlMs).toISOString(),
        };
        await set(key, entry, getStore());
        await pruneInner();
      });
    },
    prune() {
      return guard("prune", undefined, pruneInner);
    },
    deleteByPrefix(prefix: string) {
      return guard("deleteByPrefix", undefined, async () => {
        const s = getStore();
        const all = await entries(s);
        await Promise.all(
          all
            .filter(
              ([key]) => typeof key === "string" && key.startsWith(prefix),
            )
            .map(([key]) => del(key, s)),
        );
      });
    },
    clear() {
      return guard("clear", undefined, () => clear(getStore()));
    },
  };
}
