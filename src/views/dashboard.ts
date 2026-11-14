import { html, type TemplateResult } from "lit-html";
import { routeHref } from "../router";
import type { SavedLocation } from "../store/locations";

export function dashboardView(locations: SavedLocation[]): TemplateResult {
  if (locations.length === 0) {
    return html`
      <section class="card empty-state">
        <h2>No locations yet</h2>
        <p>Add a location to see its forecast, alerts and discussion.</p>
        <a class="btn" href=${routeHref({ name: "manage" })}>Add a location</a>
      </section>
    `;
  }
  // Placeholder until weather cards replace it.
  return html`
    <section class="card stack">
      <h2>Saved locations</h2>
      <ul class="loc-list">${locations.map(
        (location) => html`<li>
          <a class="loc-link" href=${routeHref({ name: "location", id: location.id })}>${location.name}</a>
        </li>`,
      )}</ul>
    </section>
  `;
}
