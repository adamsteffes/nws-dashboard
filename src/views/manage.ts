import { html, nothing, type TemplateResult } from "lit-html";
import type {
  ManageActions,
  ManageViewProps,
  Message,
} from "../app/manageController";
import { routeHref } from "../router";
import type { SavedLocation } from "../store/locations";

const inputValue = (event: Event) => (event.target as HTMLInputElement).value;

/** Always rendered so screen readers pick up text inserted into it. */
function messageRegion(message: Message | null): TemplateResult {
  return html`<div class="form-message" role="status" aria-live="polite">${
    message
      ? html`<p class=${message.kind === "error" ? "error" : "muted-ok"}>${message.text}</p>`
      : nothing
  }</div>`;
}

function placeOf(location: SavedLocation): string {
  return location.nws
    ? `${location.nws.city}, ${location.nws.state}`
    : "Not yet looked up";
}

function rowActions(
  location: SavedLocation,
  props: ManageViewProps,
  locked: boolean,
): TemplateResult {
  const { state, actions } = props;
  const { list } = state;
  const busy = list.busyId !== null;
  if (list.renamingId === location.id) {
    const fieldId = `rename-${location.id}`;
    return html`
      <form class="inline-form" @submit=${(e: Event) => {
        e.preventDefault();
        actions.submitRename();
      }}>
        <div class="field">
          <label for=${fieldId}>New name for ${location.name}</label>
          <input id=${fieldId} type="text" maxlength="60" autocomplete="off"
            .value=${list.renameValue}
            @input=${(e: Event) => actions.setRenameValue(inputValue(e))} />
        </div>
        ${list.renameError ? html`<p class="error" role="alert">${list.renameError}</p>` : nothing}
        <div class="button-row">
          <button type="submit" class="btn">Save</button>
          <button type="button" class="btn btn-secondary" @click=${actions.cancelRename}>Cancel</button>
        </div>
      </form>
    `;
  }
  if (list.deletingId === location.id) {
    return html`
      <div class="confirm-row" role="group" aria-label="Confirm delete">
        <span>Delete ${location.name}?</span>
        <button type="button" class="btn" @click=${actions.confirmDelete}>Yes</button>
        <button type="button" class="btn btn-secondary" @click=${actions.cancelDelete}>Cancel</button>
      </div>
    `;
  }
  return html`
    <div class="button-row">
      <button type="button" class="btn btn-secondary" ?disabled=${locked}
        aria-label=${`Rename ${location.name}`}
        @click=${() => actions.startRename(location.id)}>Rename</button>
      <button type="button" class="btn btn-secondary" ?disabled=${locked}
        aria-label=${`Delete ${location.name}`}
        @click=${() => actions.askDelete(location.id)}>Delete</button>
      <button type="button" class="btn btn-secondary" ?disabled=${locked || busy}
        aria-label=${`Re-resolve ${location.name}`}
        @click=${() => void actions.reresolve(location.id)}>${
          list.busyId === location.id ? "Re-resolving…" : "Re-resolve"
        }</button>
    </div>
  `;
}

function listSection(props: ManageViewProps, locked: boolean): TemplateResult {
  const { locations, state } = props;
  return html`
    <section class="card stack" aria-labelledby="saved-heading">
      <h2 id="saved-heading">Saved locations</h2>
      ${messageRegion(state.list.message)}
      ${
        locations.length === 0
          ? html`<p>No saved locations yet. Add one below.</p>`
          : html`<ul class="loc-list">${locations.map(
              (location) => html`
                <li class="loc-row">
                  <div class="loc-info">
                    <a class="loc-link" href=${routeHref({ name: "location", id: location.id })}>${location.name}</a>
                    <span class="muted">${placeOf(location)}</span>
                    <span class="muted">${location.lat}, ${location.lon}</span>
                  </div>
                  ${rowActions(location, props, locked)}
                </li>
              `,
            )}</ul>`
      }
    </section>
  `;
}

function addSection(props: ManageViewProps, locked: boolean): TemplateResult {
  const { state, actions, canGeolocate } = props;
  const add = state.add;
  const disabled = locked || add.busy;
  const field = (
    id: string,
    label: string,
    key: "name" | "lat" | "lon",
    extra: TemplateResult | typeof nothing,
  ) => html`
    <div class="field">
      <label for=${id}>${label}</label>
      <input id=${id} autocomplete="off" autocapitalize="off" spellcheck="false"
        ?disabled=${locked}
        .value=${add[key]}
        @input=${(e: Event) => actions.setAddField(key, inputValue(e))}
        inputmode=${key === "name" ? "text" : "decimal"}
        maxlength=${key === "name" ? "60" : nothing}
        type="text" />
      ${extra}
    </div>
  `;
  return html`
    <section class="card stack" aria-labelledby="add-heading">
      <h2 id="add-heading">Add a location</h2>
      <form class="stack" novalidate @submit=${(e: Event) => {
        e.preventDefault();
        void actions.submitAdd();
      }}>
        ${field("add-name", "Name", "name", nothing)}
        ${field("add-lat", "Latitude", "lat", html`<span class="hint">For example 39.7456</span>`)}
        ${field("add-lon", "Longitude", "lon", html`<span class="hint">For example -97.0892 (west is negative)</span>`)}
        <div class="button-row">
          <button type="submit" class="btn" ?disabled=${disabled}>${
            add.busy ? "Adding…" : "Add location"
          }</button>
          ${
            canGeolocate
              ? html`<button type="button" class="btn btn-secondary"
                  ?disabled=${locked || add.locating}
                  @click=${() => void actions.useMyLocation()}>${
                    add.locating ? "Locating…" : "Use my location"
                  }</button>`
              : nothing
          }
        </div>
      </form>
      ${messageRegion(add.message)}
      ${
        add.offerSaveWithout
          ? html`<div class="button-row">
              <button type="button" class="btn btn-secondary" ?disabled=${locked}
                @click=${actions.saveWithoutWeather}>Save without weather data</button>
            </div>`
          : nothing
      }
    </section>
  `;
}

function confirmReplaceRow(
  props: ManageViewProps,
  actions: ManageActions,
): TemplateResult {
  return html`
    <div class="confirm-row" role="group" aria-label="Confirm replace">
      <span>Replace your ${props.locations.length} saved ${
        props.locations.length === 1 ? "location" : "locations"
      } with this backup?</span>
      <button type="button" class="btn btn-secondary" @click=${() => void actions.exportData()}>Export first</button>
      <button type="button" class="btn" @click=${actions.confirmReplace}>Yes, replace</button>
      <button type="button" class="btn btn-secondary" @click=${actions.cancelReplace}>Cancel</button>
    </div>
  `;
}

function importResultView(
  props: ManageViewProps,
): TemplateResult | typeof nothing {
  const { result, error } = props.state.import;
  if (error) return html`<p class="error">${error}</p>`;
  if (!result) return nothing;
  const parts = [`${result.added} added`];
  if (result.skipped > 0) parts.push(`${result.skipped} already saved`);
  if (result.replaced > 0) parts.push(`${result.replaced} replaced`);
  return html`
    <p class="muted-ok">Imported: ${parts.join(", ")}.</p>
    ${
      result.warnings.length > 0
        ? html`<ul class="warnings">${result.warnings.map((w) => html`<li>${w}</li>`)}</ul>`
        : nothing
    }
  `;
}

function backupSection(
  props: ManageViewProps,
  locked: boolean,
): TemplateResult {
  const { state, actions } = props;
  const { backup } = state;
  const imp = state.import;
  return html`
    <section class="card stack" aria-labelledby="backup-heading">
      <h2 id="backup-heading">Backup</h2>
      <p class="muted">The Home Screen app and Safari keep separate lists — use Export and Import to move them.</p>

      <h3>Export</h3>
      <div class="button-row">
        <button type="button" class="btn" @click=${() => void actions.exportData()}>Export locations</button>
      </div>
      <div class="form-message" role="status" aria-live="polite">${
        backup.message
          ? html`<p class="muted-ok">${backup.message.text}</p>`
          : nothing
      }</div>
      ${
        backup.shown
          ? html`
              <div class="field">
                <label for="export-text">${backup.shown.filename}</label>
                <textarea id="export-text" readonly rows="8" .value=${backup.shown.json}></textarea>
              </div>
              <div class="button-row">
                <button type="button" class="btn btn-secondary" @click=${() => void actions.copyExport()}>Copy</button>
              </div>
            `
          : nothing
      }

      <h3>Import</h3>
      <div class="field">
        <label for="import-file">Backup file</label>
        <input id="import-file" type="file" accept="application/json,.json" ?disabled=${locked}
          @change=${(e: Event) => {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            if (file) void actions.loadImportFile(file);
            input.value = "";
          }} />
      </div>
      <div class="field">
        <label for="import-text">Or paste JSON</label>
        <textarea id="import-text" rows="6" spellcheck="false" ?disabled=${locked}
          .value=${imp.text}
          @input=${(e: Event) => actions.setImportText(inputValue(e))}></textarea>
      </div>
      <div class="field">
        <label for="import-mode">When importing</label>
        <select id="import-mode" ?disabled=${locked}
          @change=${(e: Event) => actions.setImportMode(inputValue(e) === "replace" ? "replace" : "merge")}>
          <option value="merge" ?selected=${imp.mode === "merge"}>Merge with my current list</option>
          <option value="replace" ?selected=${imp.mode === "replace"}>Replace my current list</option>
        </select>
      </div>
      ${
        imp.confirmReplace
          ? confirmReplaceRow(props, actions)
          : html`<div class="button-row">
              <button type="button" class="btn" ?disabled=${locked}
                @click=${actions.requestImport}>Import</button>
            </div>`
      }
      <div role="status" aria-live="polite">${importResultView(props)}</div>
    </section>
  `;
}

function storageSection(
  props: ManageViewProps,
): TemplateResult | typeof nothing {
  const { storage, state, actions } = props;
  const damaged = storage.corrupt || storage.dropped > 0;
  const kind = storage.readOnlyKind;
  if (
    storage.persistent &&
    !damaged &&
    !storage.readOnly &&
    !state.storageMessage
  ) {
    return nothing;
  }
  const canDiscard = kind === "backup" || kind === "backups-full";
  return html`
    <section class="card stack" aria-labelledby="storage-heading">
      <h2 id="storage-heading">Storage</h2>
      ${
        storage.persistent
          ? nothing
          : html`<p class="error">Locations are only kept until you close the app (storage unavailable).</p>`
      }
      ${
        storage.corrupt
          ? html`<p>Your saved locations couldn't be read. A copy of the unreadable data was kept as a backup.</p>`
          : storage.dropped > 0
            ? html`<p>${storage.dropped} saved ${
                storage.dropped === 1 ? "entry" : "entries"
              } couldn't be read and left out. A copy of the original data was kept as a backup.</p>`
            : nothing
      }
      ${storage.readOnlyReason ? html`<p class="error">${storage.readOnlyReason}</p>` : nothing}
      ${
        (damaged || storage.readOnly) && storage.backups.length > 0
          ? html`<div class="button-row">${storage.backups.map(
              (
                backup,
                index,
              ) => html`<button type="button" class="btn btn-secondary"
                @click=${() => actions.downloadBackup(backup.key)}>Download backup${
                  storage.backups.length > 1 ? ` ${index + 1}` : ""
                } (${backup.size} characters)</button>`,
            )}</div>`
          : nothing
      }
      ${
        kind === "backups-full"
          ? html`<div class="button-row"><button type="button" class="btn btn-secondary"
              @click=${actions.clearBackups}>Clear old backups</button></div>`
          : nothing
      }
      ${
        kind === "newer"
          ? html`<div class="button-row"><button type="button" class="btn"
              @click=${actions.reload}>Reload</button></div>`
          : nothing
      }
      ${
        canDiscard
          ? state.confirmDiscard
            ? html`<div class="confirm-row" role="group" aria-label="Confirm discard">
                <span>Discard the unreadable data? It can't be recovered afterwards.</span>
                <button type="button" class="btn" @click=${actions.confirmDiscard}>Yes, discard</button>
                <button type="button" class="btn btn-secondary" @click=${actions.cancelDiscard}>Cancel</button>
              </div>`
            : html`<div class="button-row"><button type="button" class="btn btn-secondary"
                @click=${actions.askDiscard}>Discard unreadable data and continue</button></div>`
          : nothing
      }
      <div role="status" aria-live="polite">${
        state.storageMessage
          ? html`<p class=${state.storageMessage.kind === "error" ? "error" : "muted-ok"}>${state.storageMessage.text}</p>`
          : nothing
      }</div>
    </section>
  `;
}

export function manageView(props: ManageViewProps): TemplateResult {
  const locked = props.storage.readOnly;
  return html`
    <div class="stack">
      ${storageSection(props)}
      ${listSection(props, locked)}
      ${addSection(props, locked)}
      ${backupSection(props, locked)}
    </div>
  `;
}
