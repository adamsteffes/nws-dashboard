// Unit tests must never hit the network; tests that need fetch should stub it with vi.stubGlobal.
globalThis.fetch = () =>
  Promise.reject(new Error("network disabled in unit tests"));
