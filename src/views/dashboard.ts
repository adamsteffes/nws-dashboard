import { html, nothing, type TemplateResult } from "lit-html";
import type {
  DashboardItem,
  DashboardViewProps,
} from "../app/dashboardController";
import { type Alert, highestSeverity, type Severity } from "../nws/alerts";
import type { ForecastPeriod } from "../nws/forecast";
import type { LatestObservation } from "../nws/observations";
import { CONUS_LOOP, radarUrls } from "../nws/radar";
import { routeHref } from "../router";
import type { Panel } from "../services/panels";
import type { NwsMeta } from "../store/locations";
import { ageMinutes, formatAge, formatLocal } from "../util/time";

const MIN_PRECIP_CHANCE = 10;

// Radar images are 600x550; the box reserves that shape before the image loads.
const RADAR_WIDTH = 600;
const RADAR_HEIGHT = 550;

const deviceZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

const degrees = (t: number | null): string => (t === null ? "—" : `${t}°`);

function loadingNote(label: string): TemplateResult {
  return html`<p class="panel-note muted">${label}: Loading…</p>`;
}

function errorNote(label: string, message: string | undefined): TemplateResult {
  return html`<p class="panel-note error">${label}: ${message ?? "Unavailable"}</p>`;
}

function staleNote(
  fetchedAt: string | undefined,
  zone: string,
): TemplateResult {
  if (!fetchedAt)
    return html`<p class="panel-note muted">Showing saved data</p>`;
  return html`<p class="panel-note muted">Showing saved data from ${formatLocal(fetchedAt, zone, "time")}</p>`;
}

export function alertBadgeText(alerts: Alert[]): string {
  const level = highestSeverity(alerts);
  const count = `${alerts.length} ${alerts.length === 1 ? "alert" : "alerts"}`;
  // The word carries the level on its own; color only reinforces it.
  return `${count} · ${level === "Unknown" || level === null ? "Severity unknown" : level}`;
}

const severityClass = (s: Severity | null): string =>
  `severity-${(s ?? "Unknown").toLowerCase()}`;

function alertsPanel(panel: Panel<Alert[]>, zone: string) {
  if (panel.status === "loading") return loadingNote("Alerts");
  if (panel.status === "error") return errorNote("Alerts", panel.error);
  const alerts = panel.data ?? [];
  return html`
    ${alerts.length === 0 ? nothing : html`<p class="wx-badge severity ${severityClass(highestSeverity(alerts))}">${alertBadgeText(alerts)}</p>`}
    ${panel.status === "stale" ? staleNote(panel.fetchedAt, zone) : nothing}
  `;
}

function currentPanel(
  panel: Panel<LatestObservation>,
  zone: string,
  now: Date,
) {
  if (panel.status === "loading") return loadingNote("Current conditions");
  if (panel.status === "error")
    return errorNote("Current conditions", panel.error);
  const latest = panel.data;
  if (!latest) return errorNote("Current conditions", undefined);
  const obs = latest.data;
  const showFeelsLike =
    obs.feelsLikeF !== null && obs.feelsLikeF !== obs.temperatureF;
  return html`
    <div class="wx-current">
      <p class="wx-temp">${degrees(obs.temperatureF)}</p>
      <div>
        <p class="wx-desc">${obs.textDescription}</p>
        ${showFeelsLike ? html`<p class="muted">Feels like ${degrees(obs.feelsLikeF)}</p>` : nothing}
        <p class="muted wx-age">Updated ${formatAge(ageMinutes(obs.timestamp, now))}${latest.tooOld ? html` · <strong>Reading is old</strong>` : nothing}</p>
      </div>
    </div>
    ${panel.status === "stale" ? staleNote(panel.fetchedAt, zone) : nothing}
  `;
}

function periodItem(p: ForecastPeriod) {
  const precip =
    p.precipChance !== null && p.precipChance >= MIN_PRECIP_CHANCE
      ? html` <span class="muted">Precip ${p.precipChance}%</span>`
      : nothing;
  return html`<li>
    <span class="wx-period-name">${p.name}</span>
    <span class="wx-period-temp">${degrees(p.temperature)}</span>
    <span>${p.shortForecast}</span>${precip}
  </li>`;
}

function forecastPanel(panel: Panel<ForecastPeriod[]>, zone: string) {
  if (panel.status === "loading") return loadingNote("Forecast");
  if (panel.status === "error") return errorNote("Forecast", panel.error);
  return html`
    <ul class="wx-periods">${(panel.data ?? []).map(periodItem)}</ul>
    ${panel.status === "stale" ? staleNote(panel.fetchedAt, zone) : nothing}
  `;
}

/** Swaps a broken station image for the nationwide loop, once. */
export function swapRadarOnError(event: Event): void {
  const img = event.currentTarget as HTMLImageElement;
  if (img.dataset.fallback === "1") return;
  img.dataset.fallback = "1";
  img.src = CONUS_LOOP;
}

function radar(meta: NwsMeta | undefined) {
  const urls = radarUrls(meta?.radarStation ?? null);
  if (!meta || !urls) return nothing;
  return html`<div class="wx-radar"><img src=${urls.still} alt="Radar for ${meta.city}" width=${RADAR_WIDTH} height=${RADAR_HEIGHT} loading="lazy" @error=${swapRadarOnError}></div>`;
}

function card({ location, summary }: DashboardItem, now: Date) {
  const meta = location.nws;
  const zone = meta?.timeZone ?? deviceZone();
  return html`
    <article class="card wx-card stack">
      <header class="wx-head">
        <h2><a class="wx-link" href=${routeHref({ name: "location", id: location.id })}>${location.name}</a></h2>
        ${meta ? html`<p class="muted">${meta.city}, ${meta.state}</p>` : nothing}
      </header>
      ${alertsPanel(summary.alerts, zone)}
      ${currentPanel(summary.current, zone, now)}
      ${forecastPanel(summary.forecast, zone)}
      ${radar(meta)}
    </article>
  `;
}

export function dashboardView(props: DashboardViewProps): TemplateResult {
  if (props.items.length === 0) {
    return html`
      <section class="card empty-state">
        <h2>No locations yet</h2>
        <p>Add a location to see its forecast, alerts and discussion.</p>
        <a class="btn" href=${routeHref({ name: "manage" })}>Add a location</a>
      </section>
    `;
  }
  return html`<div class="grid">${props.items.map((item) => card(item, props.now))}</div>`;
}
