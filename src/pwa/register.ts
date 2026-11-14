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

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface UpdatableRegistration {
  update(): Promise<unknown>;
}

// A Home Screen app can stay open (or be resumed) for days without a navigation,
// so look for a new worker when it comes to the foreground and hourly while visible.
export function schedulePeriodicUpdateChecks(
  registration: UpdatableRegistration | undefined,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
): () => void {
  if (!registration) return () => {};
  let checking = false;
  const check = async () => {
    if (checking || document.visibilityState !== "visible") return;
    checking = true;
    try {
      await registration.update();
    } catch {
      // Offline or server hiccup; the next trigger retries.
    } finally {
      checking = false;
    }
  };
  const onVisibility = () => void check();
  document.addEventListener("visibilitychange", onVisibility);
  const timer = setInterval(() => void check(), intervalMs);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    clearInterval(timer);
  };
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
    onRegisteredSW: (_url, registration) =>
      void schedulePeriodicUpdateChecks(registration),
    onRegisterError: (error) =>
      console.error("Service worker registration failed", error),
  });
}
