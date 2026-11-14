import { html, type TemplateResult } from "lit-html";
import { routeHref } from "../router";

export function notFoundView(): TemplateResult {
  return html`
    <section class="card">
      <h2>Page not found</h2>
      <p>That page doesn't exist.</p>
      <a href=${routeHref({ name: "dashboard" })}>Back to the dashboard</a>
    </section>
  `;
}
