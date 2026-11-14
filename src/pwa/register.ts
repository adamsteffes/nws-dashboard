export interface PwaState {
  needRefresh: boolean;
  offlineReady: boolean;
  /** Activates the waiting service worker and reloads the page. */
  update(): Promise<void>;
}

type Listener = (state: PwaState) => void;

const listeners = new Set<Listener>();
let applyUpdate: (reload?: boolean) => Promise<void> = () => Promise.resolve();

let state: PwaState = {
  needRefresh: false,
  offlineReady: false,
  update: () => applyUpdate(true),
};

function setState(
  patch: Partial<Pick<PwaState, "needRefresh" | "offlineReady">>,
) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function getPwaState(): PwaState {
  return state;
}

export function subscribePwa(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissNeedRefresh() {
  setState({ needRefresh: false });
}

export function dismissOfflineReady() {
  setState({ offlineReady: false });
}

export async function registerPwa(): Promise<void> {
  // Unit tests run without a service worker, and dev builds do not generate one.
  if (import.meta.env.MODE === "test" || !("serviceWorker" in navigator)) {
    return;
  }
  const { registerSW } = await import("virtual:pwa-register");
  applyUpdate = registerSW({
    onNeedRefresh: () => setState({ needRefresh: true }),
    onOfflineReady: () => setState({ offlineReady: true }),
    onRegisterError: (error) =>
      console.error("Service worker registration failed", error),
  });
}
