import { clear, createStore, get, promisifyRequest } from "idb-keyval";

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

// Key -> fetchedAt index kept inside the data store, so pruning reads a few
// small strings instead of deserializing every cached forecast. It is always
// updated in the same transaction as the data it describes.
const META_KEY = "__meta__";
type Meta = Record<string, string>;

const age = (fetchedAt: string | undefined): number => {
  const ms = fetchedAt === undefined ? Number.NaN : Date.parse(fetchedAt);
  // Missing or unparseable timestamps sort as oldest so they get pruned first.
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
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

  const readMeta = async (os: IDBObjectStore): Promise<Meta> =>
    ((await promisifyRequest(os.get(META_KEY))) as Meta | undefined) ?? {};

  const dataKeys = async (os: IDBObjectStore): Promise<string[]> =>
    (await promisifyRequest(os.getAllKeys())).filter(
      (k): k is string => typeof k === "string" && k !== META_KEY,
    );

  const prune = () =>
    guard("prune", undefined, () =>
      getStore()("readwrite", async (os) => {
        // One transaction for snapshot and deletes: a concurrent put cannot
        // refresh a key between the decision and the delete.
        const [keys, meta] = await Promise.all([dataKeys(os), readMeta(os)]);
        const excess = keys.length - maxEntries;
        if (excess <= 0) return;
        const oldestFirst = [...keys].sort(
          (a, b) => age(meta[a]) - age(meta[b]),
        );
        const next: Meta = {};
        for (const [i, key] of oldestFirst.entries()) {
          if (i < excess) os.delete(key);
          else next[key] = meta[key] ?? "";
        }
        os.put(next, META_KEY);
        await promisifyRequest(os.transaction);
      }),
    );

  return {
    get<T>(key: string) {
      return guard("get", undefined, () =>
        get<LastGoodEntry<T>>(key, getStore()),
      );
    },
    async put<T>(key: string, value: T, ttlMs: number) {
      await guard("put", undefined, () => {
        const now = clock();
        const entry: LastGoodEntry<T> = {
          value,
          fetchedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + ttlMs).toISOString(),
        };
        return getStore()("readwrite", async (os) => {
          os.put(entry, key);
          const meta = await readMeta(os);
          meta[key] = entry.fetchedAt;
          os.put(meta, META_KEY);
          await promisifyRequest(os.transaction);
        });
      });
      await prune();
    },
    prune,
    deleteByPrefix(prefix: string) {
      return guard("deleteByPrefix", undefined, () =>
        getStore()("readwrite", async (os) => {
          const [keys, meta] = await Promise.all([dataKeys(os), readMeta(os)]);
          for (const key of keys) {
            if (!key.startsWith(prefix)) continue;
            os.delete(key);
            delete meta[key];
          }
          os.put(meta, META_KEY);
          await promisifyRequest(os.transaction);
        }),
      );
    },
    clear() {
      return guard("clear", undefined, () => clear(getStore()));
    },
  };
}
