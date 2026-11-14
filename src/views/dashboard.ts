import { html, type TemplateResult } from "lit-html";
import { routeHref } from "../router";

export function dashboardView(): TemplateResult {
  return html`
    <section class="card empty-state">
      <h2>No locations yet</h2>
      <p>Add a location to see its forecast, alerts and discussion.</p>
      <a class="btn" href=${routeHref({ name: "manage" })}>Add a location</a>
    </section>
  `;
}
