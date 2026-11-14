import { html, type TemplateResult } from "lit-html";

export function locationView(id: string): TemplateResult {
  return html`<section class="card"><h2>Location ${id}</h2></section>`;
}
