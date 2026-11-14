import { render } from "lit-html";
import { describe, expect, it, vi } from "vitest";
import {
  dismissNeedRefresh,
  getPwaState,
  registerPwa,
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
