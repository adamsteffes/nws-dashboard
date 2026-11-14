import type { StorageLike } from "../../src/store/locations";

export type MemoryStorage = StorageLike & {
  data: Map<string, string>;
};

export type MemoryStorageOptions = {
  /** Every setItem throws, like Safari private mode. */
  failWrites?: boolean;
  /** Every getItem throws. */
  failReads?: boolean;
  /** Max total characters of keys plus values; exceeding it throws. */
  quotaBytes?: number;
};

export function createMemoryStorage(
  options: MemoryStorageOptions = {},
): MemoryStorage {
  const data = new Map<string, string>();
  const size = () =>
    [...data].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
  return {
    data,
    getItem: (key) => {
      if (options.failReads) throw new DOMException("denied", "SecurityError");
      return data.get(key) ?? null;
    },
    setItem: (key, value) => {
      const text = String(value);
      const previous = data.has(key)
        ? key.length + (data.get(key)?.length ?? 0)
        : 0;
      if (
        options.failWrites ||
        size() - previous + key.length + text.length >
          (options.quotaBytes ?? Number.POSITIVE_INFINITY)
      ) {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      }
      data.set(key, text);
    },
  };
}
