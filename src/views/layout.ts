import { html, nothing, type TemplateResult } from "lit-html";
import { type Route, routeHref } from "../router";

export interface LayoutProps {
  route: Route;
  title: string;
  online: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  content: TemplateResult;
  version: string;
}

function current(active: boolean) {
  return active ? "page" : nothing;
}

// Keep the hash untouched: it is the router's state, and "#main" is not a route.
function skipToMain(event: Event) {
  event.preventDefault();
  document.getElementById("main")?.focus();
}

export function layoutView(props: LayoutProps): TemplateResult {
  const { route, title, online, refreshing, onRefresh, content, version } =
    props;
  const onDashboard =
    route.name === "dashboard" ||
    route.name === "location" ||
    route.name === "discussion";
  return html`
    <a class="skip-link" href="#main" @click=${skipToMain}>Skip to content</a>
    <header class="app-header">
      <h1 id="page-title" tabindex="-1">${title}</h1>
      <nav aria-label="Primary">
        <a href=${routeHref({ name: "dashboard" })} aria-current=${current(onDashboard)}>Dashboard</a>
        <a href=${routeHref({ name: "manage" })} aria-current=${current(route.name === "manage")}>Locations</a>
      </nav>
      <button type="button" class="btn" ?disabled=${refreshing} @click=${onRefresh}>
        ${refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </header>
    <div class="banner-region" role="status" aria-live="polite">${online ? nothing : html`<div class="banner banner-offline">You're offline — showing saved data</div>`}</div>
    <main id="main" class="app-main" tabindex="-1">${content}</main>
    <footer class="app-footer">
      <span class="version">Version ${version}</span>
      <span>Data: <a href="https://www.weather.gov/" target="_blank" rel="noopener noreferrer">National Weather Service</a></span>
    </footer>
  `;
}
