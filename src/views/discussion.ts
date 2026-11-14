import { html, nothing, type TemplateResult } from "lit-html";
import { routeHref } from "../router";

export function discussionView(id: string, productId?: string): TemplateResult {
  return html`
    <section class="card">
      <h2>Forecast discussion for ${id}</h2>
      ${productId ? html`<p>Product ${productId}</p>` : nothing}
      <a href=${routeHref({ name: "location", id })}>Back to location</a>
    </section>
  `;
}
