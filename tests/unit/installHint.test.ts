import { render } from "lit-html";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissInstallHint,
  INSTALL_HINT_KEY,
  type InstallHintEnv,
  installHintView,
  isInstallHintDismissed,
  shouldShowInstallHint,
} from "../../src/pwa/installHint";

const IPAD_SAFARI_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_CHROME_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const base: InstallHintEnv = {
  userAgent: IPAD_SAFARI_UA,
  maxTouchPoints: 5,
  platform: "iPad",
  standalone: false,
  displayModeStandalone: false,
  dismissed: false,
};

describe("shouldShowInstallHint", () => {
  const cases: [string, Partial<InstallHintEnv>, boolean][] = [
    ["iPad Safari", {}, true],
    [
      "iPadOS desktop-mode Mac UA with touch points",
      {
        userAgent: MAC_UA,
        platform: "MacIntel",
        maxTouchPoints: 5,
        standalone: undefined,
      },
      true,
    ],
    [
      "iPhone Safari",
      { userAgent: IPHONE_UA, platform: "iPhone", maxTouchPoints: 5 },
      true,
    ],
    [
      "Mac Safari without touch",
      {
        userAgent: MAC_UA,
        platform: "MacIntel",
        maxTouchPoints: 0,
        standalone: undefined,
      },
      false,
    ],
    [
      "Chrome on Android",
      {
        userAgent: ANDROID_CHROME_UA,
        platform: "Linux armv81",
        maxTouchPoints: 5,
        standalone: undefined,
      },
      false,
    ],
    ["Chrome on iPad", { userAgent: IPAD_CHROME_UA }, false],
    ["navigator.standalone", { standalone: true }, false],
    ["display-mode standalone", { displayModeStandalone: true }, false],
    ["already dismissed", { dismissed: true }, false],
  ];

  it.each(cases)("%s", (_name, overrides, expected) => {
    expect(shouldShowInstallHint({ ...base, ...overrides })).toBe(expected);
  });
});

describe("dismissal storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("persists the dismissal", () => {
    expect(isInstallHintDismissed()).toBe(false);
    dismissInstallHint();
    expect(localStorage.getItem(INSTALL_HINT_KEY)).toBe("1");
    expect(isInstallHintDismissed()).toBe(true);
  });

  it("uses the documented key", () => {
    expect(INSTALL_HINT_KEY).toBe("nwsdash:installHintDismissed");
  });

  it("tolerates storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isInstallHintDismissed()).toBe(false);
    expect(() => dismissInstallHint()).not.toThrow();
  });
});

describe("installHintView", () => {
  it("renders nothing when not visible", () => {
    const el = document.createElement("div");
    render(installHintView({ visible: false, onDismiss: () => {} }), el);
    expect(el.querySelector(".banner")).toBeNull();
  });

  it("shows the instructions and calls onDismiss", () => {
    const el = document.createElement("div");
    const onDismiss = vi.fn();
    render(installHintView({ visible: true, onDismiss }), el);
    expect(el.textContent).toContain("tap Share, then Add to Home Screen");
    expect(el.textContent).toContain("Export/Import on the Locations page");
    el.querySelector("button")?.click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
