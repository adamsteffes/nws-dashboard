import { html, nothing, type TemplateResult } from "lit-html";
import type { DiscussionViewProps } from "../app/discussionController";
import { type AfdSection, type ProductRef, splitSections } from "../nws/afd";
import { routeHref } from "../router";
import type { Panel } from "../services/panels";
import { deviceZone, formatLocalWithZone } from "../util/time";

export type DiscussionViewHandlers = {
  onSections: (on: boolean) => void;
};

/** Date and local time in the location's zone; the zone name keeps it unambiguous. */
const localIssued = (iso: string, zone: string): string =>
  formatLocalWithZone(iso, zone, "dateTime", { alwaysZone: true });

const sectionId = (index: number): string => `afd-section-${index}`;

/** Scrolls within the page; following the link would replace the router's hash. */
export function jumpToSection(event: Event, id: string): void {
  event.preventDefault();
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ block: "start" });
  target.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
}

function loadingNote(label: string): TemplateResult {
  return html`<p class="panel-note muted">${label}: Loading…</p>`;
}

function errorNote(label: string, message: string | undefined): TemplateResult {
  return html`<p class="panel-note error">${label}: ${message ?? "Unavailable"}</p>`;
}

function staleNote(fetchedAt: string | undefined, zone: string) {
  const when = fetchedAt ? localIssued(fetchedAt, zone) : "—";
  return html`<p class="panel-note muted">Showing saved data${when === "—" ? nothing : html` from ${when}`}</p>`;
}

function toc(sections: AfdSection[], pageHref: string) {
  const entries = sections.flatMap((section, index) =>
    section.title === null ? [] : [{ title: section.title, index }],
  );
  if (entries.length === 0) return nothing;
  return html`
    <nav class="afd-toc" aria-label="Sections">
      <ol>${entries.map(
        ({ title, index }) =>
          html`<li><a href=${pageHref} @click=${(e: Event) => jumpToSection(e, sectionId(index))}>${title}</a></li>`,
      )}</ol>
    </nav>
  `;
}

function sectionedText(text: string, pageHref: string) {
  const sections = splitSections(text);
  return html`
    ${toc(sections, pageHref)}
    ${sections.map(
      (section, index) => html`
        <section id=${sectionId(index)} class="afd-section">
          ${section.title === null ? nothing : html`<h3 tabindex="-1">${section.title}</h3>`}
          <pre class="afd-text">${section.body}</pre>
        </section>`,
    )}
  `;
}

function history(
  list: Panel<ProductRef[]>,
  currentId: string | undefined,
  locationId: string,
  zone: string,
) {
  if (list.status === "loading") return loadingNote("Previous discussions");
  if (list.status === "error") {
    return errorNote("Previous discussions", list.error);
  }
  const refs = list.data ?? [];
  if (refs.length === 0) return nothing;
  return html`
    <section class="afd-history">
      <h3>Previous discussions</h3>
      <ul>${refs.map((ref) =>
        ref.id === currentId
          ? html`<li><span class="afd-current" aria-current="true">${localIssued(ref.issuanceTime, zone)} (showing)</span></li>`
          : html`<li><a href=${routeHref({ name: "discussion", id: locationId, productId: ref.id })}>${localIssued(ref.issuanceTime, zone)}</a></li>`,
      )}</ul>
      ${list.status === "stale" ? staleNote(list.fetchedAt, zone) : nothing}
    </section>
  `;
}

export function discussionView(
  props: DiscussionViewProps,
  handlers: DiscussionViewHandlers,
): TemplateResult {
  const { location, list, product, sections } = props;
  if (!location) {
    return html`
      <section class="card">
        <h2>Location not found</h2>
        <p>That location isn't in your saved list. It may have been deleted.</p>
        <a class="back-link" href=${routeHref({ name: "manage" })}>Go to Locations</a>
      </section>
    `;
  }
  const zone = location.nws?.timeZone ?? deviceZone();
  // The links keep the page's own URL so a copied link is a valid route; clicks only scroll.
  const pageHref = routeHref({
    name: "discussion",
    id: location.id,
    ...(props.productId === undefined ? {} : { productId: props.productId }),
  });
  const data = product.data;
  const office =
    data?.issuingOffice ||
    list.data?.[0]?.issuingOffice ||
    location.nws?.cwa ||
    "";
  const newestId = list.data?.[0]?.id;
  // Only the newest-first path can land on an older product by fallback.
  const olderThanNewest =
    props.productId === undefined &&
    data !== undefined &&
    newestId !== undefined &&
    data.id !== newestId;

  let body: TemplateResult | typeof nothing;
  if (product.status === "loading") {
    body = loadingNote("Discussion");
  } else if (product.status === "error") {
    body = html`<p class="panel-note error">The discussion couldn't be loaded${product.error ? html` (${product.error})` : nothing}.</p>`;
  } else if (!data) {
    body = html`<p>No discussion available</p>`;
  } else {
    body = html`
      <p class="muted">${office ? `${office} — ` : ""}issued ${localIssued(data.issuanceTime, zone)} · for ${location.name}</p>
      ${olderThanNewest ? html`<p class="panel-note muted">The newest discussion couldn't be loaded; this is an older one.</p>` : nothing}
      ${product.status === "stale" ? staleNote(product.fetchedAt, zone) : nothing}
      <button type="button" class="btn btn-secondary afd-toggle" aria-pressed=${sections ? "true" : "false"} @click=${() => handlers.onSections(!sections)}>Sections</button>
      ${sections ? sectionedText(data.text, pageHref) : html`<pre class="afd-text">${data.text}</pre>`}
    `;
  }

  return html`
    <section class="card stack afd-page">
      <a class="back-link" href=${routeHref({ name: "location", id: location.id })}>← Back to ${location.name}</a>
      <h2>Forecast discussion</h2>
      ${body}
      ${history(list, data?.id ?? props.productId, location.id, zone)}
    </section>
  `;
}
