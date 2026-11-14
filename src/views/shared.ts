import { html, type TemplateResult } from "lit-html";
import type { Severity } from "../nws/alerts";
import { CONUS_LOOP } from "../nws/radar";
import { formatLocal, type TimeStyle } from "../util/time";

// Radar images are 600x550; the box reserves that shape before the image loads.
export const RADAR_WIDTH = 600;
export const RADAR_HEIGHT = 550;

export const deviceZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

export const degrees = (t: number | null): string =>
  t === null ? "—" : `${t}°`;

export function loadingNote(label: string): TemplateResult {
  return html`<p class="panel-note muted">${label}: Loading…</p>`;
}

export function errorNote(
  label: string,
  message: string | undefined,
): TemplateResult {
  return html`<p class="panel-note error">${label}: ${message ?? "Unavailable"}</p>`;
}

export const dayKey = (date: Date, zone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(date);

export function zoneAbbreviation(date: Date, zone: string): string | undefined {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
}

export function staleNote(
  fetchedAt: string | undefined,
  zone: string,
  now: Date,
): TemplateResult {
  const saved = fetchedAt ? new Date(fetchedAt) : null;
  if (!fetchedAt || !saved || Number.isNaN(saved.getTime())) {
    return html`<p class="panel-note muted">Showing saved data</p>`;
  }
  // A bare time is ambiguous for data from an earlier day.
  const today = dayKey(saved, zone) === dayKey(now, zone);
  let when = formatLocal(fetchedAt, zone, today ? "time" : "dateTime");
  // The location's clock differs from the device's, so say whose it is.
  if (zone !== deviceZone()) {
    const abbreviation = zoneAbbreviation(saved, zone);
    if (abbreviation) when = `${when} ${abbreviation}`;
  }
  return html`<p class="panel-note muted">Showing saved data from ${when}</p>`;
}

export const severityClass = (s: Severity | null): string =>
  `severity-${(s ?? "Unknown").toLowerCase()}`;

const FALLBACK_ALT = "National radar (station image unavailable)";

/** Swaps a broken station image for the nationwide loop, once. */
export function swapRadarOnError(event: Event): void {
  const img = event.currentTarget as HTMLImageElement;
  if (img.dataset.fallback === "1") return;
  img.dataset.fallback = "1";
  img.dataset.alt = img.alt;
  img.alt = FALLBACK_ALT;
  img.src = CONUS_LOOP;
}

/** A station image that loads again (new station after a re-resolve) re-arms the fallback. */
export function resetRadarOnLoad(event: Event): void {
  const img = event.currentTarget as HTMLImageElement;
  if (img.dataset.fallback !== "1" || img.src === CONUS_LOOP) return;
  delete img.dataset.fallback;
  img.alt = img.dataset.alt ?? img.alt;
}

/** A time in the location's zone; names the zone when it differs from the device's. */
export function localTime(iso: string, zone: string, style: TimeStyle): string {
  const when = formatLocal(iso, zone, style);
  const date = new Date(iso);
  if (zone === deviceZone() || Number.isNaN(date.getTime())) return when;
  const abbreviation = zoneAbbreviation(date, zone);
  return abbreviation ? `${when} ${abbreviation}` : when;
}
