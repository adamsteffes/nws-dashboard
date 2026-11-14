import { html, nothing, type TemplateResult } from "lit-html";

export const INSTALL_HINT_KEY = "nwsdash:installHintDismissed";

export interface InstallHintEnv {
  userAgent: string;
  maxTouchPoints: number;
  platform: string;
  /** navigator.standalone (iOS only). */
  standalone: boolean | undefined;
  displayModeStandalone: boolean;
  dismissed: boolean;
}

export function shouldShowInstallHint(env: InstallHintEnv): boolean {
  const {
    userAgent,
    maxTouchPoints,
    platform,
    standalone,
    displayModeStandalone,
    dismissed,
  } = env;
  if (dismissed || standalone === true || displayModeStandalone) return false;
  const iPhoneOrOldIPad = /\b(iPhone|iPad|iPod)\b/.test(userAgent);
  // iPadOS 13+ reports a Mac user agent; only touch support tells it apart from a real Mac.
  const iPadOs = platform === "MacIntel" && maxTouchPoints > 1;
  if (!iPhoneOrOldIPad && !iPadOs) return false;
  // Only Safari can add to the Home Screen from its Share menu in a way we document;
  // other iOS browsers tag themselves (CriOS, FxiOS, EdgiOS, OPiOS).
  return !/\b(CriOS|FxiOS|EdgiOS|OPiOS)\b/.test(userAgent);
}

export function isInstallHintDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissInstallHint(): void {
  try {
    localStorage.setItem(INSTALL_HINT_KEY, "1");
  } catch {
    // Storage may be blocked; the hint then reappears next visit, which is acceptable.
  }
}

export function isStandalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

export function currentInstallHintEnv(): InstallHintEnv {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    platform: navigator.platform,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)")
      .matches,
    dismissed: isInstallHintDismissed(),
  };
}

export function installHintView(props: {
  visible: boolean;
  onDismiss: () => void;
}): TemplateResult | typeof nothing {
  if (!props.visible) return nothing;
  return html`
    <div class="banner banner-action banner-install" role="note">
      <p>Install: tap Share, then Add to Home Screen. Saved locations don't carry over from Safari to the Home Screen app — use Export/Import on the Locations page.</p>
      <div class="banner-buttons">
        <button type="button" class="btn btn-secondary" aria-label="Dismiss install tip" @click=${props.onDismiss}>Dismiss</button>
      </div>
    </div>
  `;
}
