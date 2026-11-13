import { html, type TemplateResult } from "lit-html";

export function homeView(version: string): TemplateResult {
  return html`
    <h1>NWS Weather</h1>
    <p>Dashboard coming soon</p>
    <p class="version">Version ${version}</p>
  `;
}
