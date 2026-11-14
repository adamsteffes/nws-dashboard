import type { StorageLike } from "../../src/store/locations";

export type MemoryStorage = StorageLike & {
  data: Map<string, string>;
};

export function createMemoryStorage(
  options: { failWrites?: boolean } = {},
): MemoryStorage {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (options.failWrites) {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      }
      data.set(key, String(value));
    },
  };
}
