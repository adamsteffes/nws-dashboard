export type Limiter = {
  <T>(task: () => Promise<T>): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
};

export function createLimiter(max: number): Limiter {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`limiter max must be an integer >= 1, got ${max}`);
  }
  let active = 0;
  const queue: (() => void)[] = [];

  const release = () => {
    active--;
    queue.shift()?.();
  };

  const run = <T>(task: () => Promise<T>): Promise<T> => {
    active++;
    return (async () => task())().finally(release);
  };

  const limiter = <T>(task: () => Promise<T>): Promise<T> => {
    if (active < max) return run(task);
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        run(task).then(resolve, reject);
      });
    });
  };

  Object.defineProperties(limiter, {
    activeCount: { get: () => active },
    pendingCount: { get: () => queue.length },
  });
  return limiter as Limiter;
}
