import { render } from "lit-html";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissNeedRefresh,
  getPwaState,
  registerPwa,
  schedulePeriodicUpdateChecks,
  subscribePwa,
} from "../../src/pwa/register";
import {
  type UpdatePromptProps,
  updatePromptView,
} from "../../src/pwa/updatePrompt";

function mount(overrides: Partial<UpdatePromptProps> = {}) {
  const el = document.createElement("div");
  const props: UpdatePromptProps = {
    needRefresh: false,
    offlineReady: false,
    onReload: vi.fn(),
    onLater: vi.fn(),
    onDismissOfflineReady: vi.fn(),
    ...overrides,
  };
  render(updatePromptView(props), el);
  return { el, props };
}

function button(el: HTMLElement, name: string) {
  const found = [...el.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

describe("updatePromptView", () => {
  it("renders nothing by default", () => {
    expect(mount().el.querySelector(".banner")).toBeNull();
  });

  it("offers Reload and Later when an update is waiting", () => {
    const { el, props } = mount({ needRefresh: true });
    expect(el.textContent).toContain("A new version is available.");
    button(el, "Reload").click();
    expect(props.onReload).toHaveBeenCalledOnce();
    button(el, "Later").click();
    expect(props.onLater).toHaveBeenCalledOnce();
  });

  it("shows a dismissible offline-ready note", () => {
    const { el, props } = mount({ offlineReady: true });
    expect(el.textContent).toContain("Ready to work offline.");
    expect(button(el, "Dismiss").getAttribute("aria-label")).toBe(
      "Dismiss offline notice",
    );
    button(el, "Dismiss").click();
    expect(props.onDismissOfflineReady).toHaveBeenCalledOnce();
  });

  it("prefers the update prompt when both flags are set", () => {
    const { el } = mount({ needRefresh: true, offlineReady: true });
    expect(el.textContent).toContain("A new version is available.");
    expect(el.textContent).not.toContain("Ready to work offline.");
  });
});

describe("pwa state", () => {
  it("starts idle, does not register in tests, and notifies subscribers", async () => {
    expect(getPwaState().needRefresh).toBe(false);
    await registerPwa();
    expect(getPwaState().offlineReady).toBe(false);

    const listener = vi.fn();
    const unsubscribe = subscribePwa(listener);
    dismissNeedRefresh();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    dismissNeedRefresh();
    expect(listener).toHaveBeenCalledOnce();
    await expect(getPwaState().update()).resolves.toBeUndefined();
  });
});

describe("schedulePeriodicUpdateChecks", () => {
  const HOUR = 60 * 60 * 1000;
  let visibility: DocumentVisibilityState = "visible";

  function setup() {
    vi.useFakeTimers();
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("checks hourly while visible and not while hidden", async () => {
    setup();
    const registration = { update: vi.fn(() => Promise.resolve()) };
    const stop = schedulePeriodicUpdateChecks(registration);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(registration.update).toHaveBeenCalledTimes(1);
    visibility = "hidden";
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(registration.update).toHaveBeenCalledTimes(1);
    stop();
    visibility = "visible";
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it("checks when the page becomes visible", async () => {
    setup();
    const registration = { update: vi.fn(() => Promise.resolve()) };
    const stop = schedulePeriodicUpdateChecks(registration);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(registration.update).toHaveBeenCalledTimes(1);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(registration.update).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not overlap checks and survives failures", async () => {
    setup();
    let finish: () => void = () => {};
    const registration = {
      update: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const stop = schedulePeriodicUpdateChecks(registration);
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(registration.update).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);

    registration.update.mockRejectedValueOnce(new Error("offline"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(registration.update).toHaveBeenCalledTimes(3);
    stop();
  });

  it("is a no-op without a registration", () => {
    expect(() => schedulePeriodicUpdateChecks(undefined)()).not.toThrow();
  });
});
