import { describe, expect, it } from "vitest";
import { createLimiter } from "../../src/util/limiter";

function deferred<T = void>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createLimiter", () => {
  it("never runs more than max tasks at once", async () => {
    const limit = createLimiter(2);
    const gates = Array.from({ length: 5 }, () => deferred());
    let running = 0;
    let peak = 0;
    const results = gates.map((g, i) =>
      limit(async () => {
        running++;
        peak = Math.max(peak, running);
        await g.promise;
        running--;
        return i;
      }),
    );
    expect(limit.activeCount).toBe(2);
    expect(limit.pendingCount).toBe(3);
    for (const g of gates) {
      g.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });

  it("starts queued tasks in FIFO order", async () => {
    const limit = createLimiter(1);
    const started: number[] = [];
    const gates = Array.from({ length: 4 }, () => deferred());
    const results = gates.map((g, i) =>
      limit(async () => {
        started.push(i);
        await g.promise;
      }),
    );
    for (const g of gates) {
      g.resolve();
      await Promise.resolve();
    }
    await Promise.all(results);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it("releases the slot when a task rejects", async () => {
    const limit = createLimiter(1);
    const failing = limit(() => Promise.reject(new Error("boom")));
    const next = limit(async () => "ran");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });

  it("releases the slot when a task throws synchronously", async () => {
    const limit = createLimiter(1);
    const failing = limit(() => {
      throw new Error("sync");
    });
    await expect(failing).rejects.toThrow("sync");
    await expect(limit(async () => "ok")).resolves.toBe("ok");
  });
});
