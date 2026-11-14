import { html, nothing, type TemplateResult } from "lit-html";

export interface UpdatePromptProps {
  needRefresh: boolean;
  offlineReady: boolean;
  onReload: () => void;
  onLater: () => void;
  onDismissOfflineReady: () => void;
}

// Rendered inside the layout's role="status" region so screen readers hear it.
export function updatePromptView(
  props: UpdatePromptProps,
): TemplateResult | typeof nothing {
  const {
    needRefresh,
    offlineReady,
    onReload,
    onLater,
    onDismissOfflineReady,
  } = props;
  if (needRefresh) {
    return html`
      <div class="banner banner-action banner-update">
        <p>A new version is available.</p>
        <div class="banner-buttons">
          <button type="button" class="btn" @click=${onReload}>Reload</button>
          <button type="button" class="btn btn-secondary" @click=${onLater}>Later</button>
        </div>
      </div>
    `;
  }
  if (offlineReady) {
    return html`
      <div class="banner banner-action banner-offline-ready">
        <p>Ready to work offline.</p>
        <div class="banner-buttons">
          <button type="button" class="btn btn-secondary" @click=${onDismissOfflineReady}>Dismiss</button>
        </div>
      </div>
    `;
  }
  return nothing;
}
