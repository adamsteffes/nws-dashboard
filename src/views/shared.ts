import { html, type TemplateResult } from "lit-html";
import type { Severity } from "../nws/alerts";
import { CONUS_LOOP } from "../nws/radar";
import { formatLocalWithZone, type TimeStyle } from "../util/time";

export { deviceZone, zoneAbbreviation } from "../util/time";

// Radar images are 600x550; the box reserves that shape before the image loads.
export const RADAR_WIDTH = 600;
export const RADAR_HEIGHT = 550;

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

type ZoneOptions = { alwaysZone?: boolean };

export const dayKey = (date: Date, zone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(date);

export function staleNote(
  fetchedAt: string | undefined,
  zone: string,
  now: Date,
  opts: ZoneOptions = {},
): TemplateResult {
  const saved = fetchedAt ? new Date(fetchedAt) : null;
  if (!fetchedAt || !saved || Number.isNaN(saved.getTime())) {
    return html`<p class="panel-note muted">Showing saved data</p>`;
  }
  // A bare time is ambiguous for data from an earlier day.
  const today = dayKey(saved, zone) === dayKey(now, zone);
  const when = formatLocalWithZone(
    fetchedAt,
    zone,
    today ? "time" : "dateTime",
    opts,
  );
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

/** A time in the location's zone; names the zone when it differs from the device's (or always, with `alwaysZone`). */
export function localTime(
  iso: string,
  zone: string,
  style: TimeStyle,
  opts: ZoneOptions = {},
): string {
  return formatLocalWithZone(iso, zone, style, opts);
}
