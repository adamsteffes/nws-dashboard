import { html, type TemplateResult } from "lit-html";
import { routeHref } from "../router";
import type { SavedLocation } from "../store/locations";

export function locationView(
  location: SavedLocation | undefined,
): TemplateResult {
  if (!location) {
    return html`
      <section class="card">
        <h2>Location not found</h2>
        <p>That location isn't in your saved list. It may have been deleted.</p>
        <a href=${routeHref({ name: "manage" })}>Go to Locations</a>
      </section>
    `;
  }
  return html`<section class="card"><h2>${location.name}</h2></section>`;
}
