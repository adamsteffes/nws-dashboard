import { html, nothing, type TemplateResult } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import type { LocationViewProps } from "../app/locationController";
import type { Alert } from "../nws/alerts";
import type { Forecast, ForecastPeriod } from "../nws/forecast";
import type { LatestObservation } from "../nws/observations";
import { radarUrls } from "../nws/radar";
import { routeHref } from "../router";
import type { Panel } from "../services/panels";
import type { NwsMeta, SavedLocation } from "../store/locations";
import { ageMinutes, formatAge, formatLocal } from "../util/time";
import {
  dayKey,
  degrees,
  deviceZone,
  errorNote,
  loadingNote,
  localTime,
  RADAR_HEIGHT,
  RADAR_WIDTH,
  resetRadarOnLoad,
  severityClass,
  staleNote,
  swapRadarOnError,
} from "./shared";

const MIN_PRECIP_CHANCE = 10;
const NO_VALUE = "—";

const optional = (value: number | null, unit: string): string =>
  value === null ? NO_VALUE : `${value}${unit}`;

/** "NW 12 mph, gusts 20", or "Calm". */
export function windText(obs: LatestObservation["data"]): string {
  if (obs.windMph === null) return NO_VALUE;
  if (obs.windMph === 0) return "Calm";
  const base = [obs.windDirection, `${obs.windMph} mph`]
    .filter(Boolean)
    .join(" ");
  return obs.windGustMph !== null && obs.windGustMph > obs.windMph
    ? `${base}, gusts ${obs.windGustMph}`
    : base;
}

const severityText = (alert: Alert): string =>
  alert.severity === "Unknown" ? "Severity unknown" : alert.severity;

function alertItem(alert: Alert, zone: string) {
  const until = alert.ends ?? alert.expires;
  const times: [string, string | null][] = [
    ["Effective", alert.effective],
    ["Onset", alert.onset],
    ["Expires", alert.expires],
    ["Ends", alert.ends],
  ];
  return html`<details class="alert-item">
    <summary>
      <span class="alert-event">${alert.event}</span>
      <span class="severity ${severityClass(alert.severity)}">${severityText(alert)}</span>
      ${until ? html`<span class="muted">until ${localTime(until, zone, "dateTime")}</span>` : nothing}
    </summary>
    <div class="alert-body stack">
      ${alert.headline ? html`<p><strong>${alert.headline}</strong></p>` : nothing}
      ${alert.areaDesc ? html`<p class="muted">${alert.areaDesc}</p>` : nothing}
      ${alert.description ? html`<p class="pre-text">${alert.description}</p>` : nothing}
      ${
        alert.instruction
          ? html`<div><h4>What to do</h4><p class="pre-text">${alert.instruction}</p></div>`
          : nothing
      }
      <dl class="facts">
        ${times.map(([label, value]) =>
          value
            ? html`<div><dt>${label}</dt><dd>${localTime(value, zone, "dateTime")}</dd></div>`
            : nothing,
        )}
      </dl>
      ${alert.senderName ? html`<p class="muted">${alert.senderName}</p>` : nothing}
    </div>
  </details>`;
}

function alertsSection(panel: Panel<Alert[]>, zone: string, now: Date) {
  const alerts = panel.data ?? [];
  return html`<section class="card stack" aria-labelledby="alerts-h">
    <h2 id="alerts-h">Alerts</h2>
    ${
      panel.status === "loading"
        ? loadingNote("Alerts")
        : panel.status === "error"
          ? errorNote("Alerts", panel.error)
          : html`
            ${
              alerts.length === 0
                ? html`<p>No active alerts</p>`
                : repeat(
                    alerts,
                    (a) => a.id,
                    (a) => alertItem(a, zone),
                  )
            }
            ${panel.status === "stale" ? staleNote(panel.fetchedAt, zone, now) : nothing}`
    }
  </section>`;
}

function currentBody(latest: LatestObservation, zone: string, now: Date) {
  const obs = latest.data;
  const showFeelsLike =
    obs.feelsLikeF !== null && obs.feelsLikeF !== obs.temperatureF;
  const facts: [string, string][] = [
    ...(showFeelsLike
      ? ([["Feels like", degrees(obs.feelsLikeF)]] as [string, string][])
      : []),
    ["Dew point", degrees(obs.dewpointF)],
    ["Humidity", optional(obs.humidity, "%")],
    ["Wind", windText(obs)],
    [
      "Pressure",
      obs.pressureInHg === null
        ? NO_VALUE
        : `${obs.pressureInHg.toFixed(2)} inHg`,
    ],
    ["Visibility", optional(obs.visibilityMi, " mi")],
    ["Station", obs.stationId || NO_VALUE],
  ];
  return html`
    <div class="wx-current">
      <p class="wx-temp">${degrees(obs.temperatureF)}</p>
      <p class="wx-desc">${obs.textDescription || NO_VALUE}</p>
    </div>
    <dl class="facts">
      ${facts.map(([label, value]) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`)}
    </dl>
    <p class="muted wx-age">Observed ${obs.timestamp ? localTime(obs.timestamp, zone, "time") : NO_VALUE} (${formatAge(ageMinutes(obs.timestamp, now))})${latest.tooOld ? html` · <strong>Reading is old</strong>` : nothing}</p>
  `;
}

function currentSection(
  panel: Panel<LatestObservation>,
  zone: string,
  now: Date,
) {
  return html`<section class="card stack" aria-labelledby="current-h">
    <h2 id="current-h">Current conditions</h2>
    ${
      panel.status === "loading"
        ? loadingNote("Current conditions")
        : panel.status === "error" || !panel.data
          ? errorNote("Current conditions", panel.error)
          : html`${currentBody(panel.data, zone, now)}
            ${panel.status === "stale" ? staleNote(panel.fetchedAt, zone, now) : nothing}`
    }
  </section>`;
}

function radarBody(meta: NwsMeta | undefined, online: boolean) {
  const urls = radarUrls(meta?.radarStation ?? null);
  if (!online) {
    return html`<p class="panel-note muted">Radar isn't available offline</p>`;
  }
  if (!meta) return loadingNote("Radar");
  if (!urls) {
    return html`<p class="panel-note muted">No radar station for this location</p>`;
  }
  return html`
    <div class="wx-radar"><img src=${urls.loop} alt="Radar loop for ${meta.city}" width=${RADAR_WIDTH} height=${RADAR_HEIGHT} loading="lazy" @error=${swapRadarOnError} @load=${resetRadarOnLoad}></div>
    <a class="btn btn-secondary" href=${urls.page} target="_blank" rel="noopener">Open full radar</a>
  `;
}

function radarSection(meta: NwsMeta | undefined, online: boolean) {
  return html`<section class="card stack" aria-labelledby="radar-h">
    <h2 id="radar-h">Radar</h2>
    ${radarBody(meta, online)}
  </section>`;
}

function periodItem(p: ForecastPeriod) {
  const precip =
    p.precipChance !== null && p.precipChance >= MIN_PRECIP_CHANCE
      ? html` <span class="muted">Precip ${p.precipChance}%</span>`
      : nothing;
  return html`<li>
    <div class="period-head">
      <span class="wx-period-name">${p.name}</span>
      <span class="wx-period-temp">${p.isDaytime ? "High" : "Low"} ${degrees(p.temperature)}</span>
    </div>
    <p>${p.shortForecast}${precip}</p>
    ${
      p.detailedForecast
        ? html`<details class="period-details"><summary>Details</summary><p>${p.detailedForecast}</p></details>`
        : nothing
    }
  </li>`;
}

function forecastSection(panel: Panel<Forecast>, zone: string, now: Date) {
  return html`<section class="card stack" aria-labelledby="forecast-h">
    <h2 id="forecast-h">7-day forecast</h2>
    ${
      panel.status === "loading"
        ? loadingNote("Forecast")
        : panel.status === "error"
          ? errorNote("Forecast", panel.error)
          : html`<ul class="wx-periods detail-periods">${repeat(panel.data?.periods ?? [], (p) => p.startTime, periodItem)}</ul>
            ${panel.status === "stale" ? staleNote(panel.fetchedAt, zone, now) : nothing}`
    }
  </section>`;
}

function hourWind(p: ForecastPeriod): string {
  return [p.windDirection, p.windSpeed].filter(Boolean).join(" ") || NO_VALUE;
}

function hourRows(periods: ForecastPeriod[], zone: string) {
  let previousDay = "";
  return periods.map((p) => {
    const day = dayKey(new Date(p.startTime), zone);
    const separator =
      day === previousDay
        ? nothing
        : html`<tr class="day-row"><th colspan="5" scope="colgroup"><span>${formatLocal(p.startTime, zone, "weekday")}</span></th></tr>`;
    previousDay = day;
    return html`${separator}<tr>
      <th scope="row">${formatLocal(p.startTime, zone, "time")}</th>
      <td>${degrees(p.temperature)}</td>
      <td>${p.precipChance !== null && p.precipChance >= MIN_PRECIP_CHANCE ? `${p.precipChance}%` : NO_VALUE}</td>
      <td>${hourWind(p)}</td>
      <td>${p.shortForecast}</td>
    </tr>`;
  });
}

function hourlySection(
  panel: Panel<ForecastPeriod[]>,
  zone: string,
  now: Date,
) {
  return html`<section class="card stack" aria-labelledby="hourly-h">
    <h2 id="hourly-h">Next 48 hours</h2>
    ${
      panel.status === "loading"
        ? loadingNote("Hourly forecast")
        : panel.status === "error"
          ? errorNote("Hourly forecast", panel.error)
          : html`<div class="table-scroll" role="region" aria-labelledby="hourly-h" tabindex="0">
              <table class="hourly">
                <thead><tr><th scope="col">Time</th><th scope="col">Temp</th><th scope="col">Precip</th><th scope="col">Wind</th><th scope="col">Forecast</th></tr></thead>
                <tbody>${hourRows(panel.data ?? [], zone)}</tbody>
              </table>
            </div>
            ${panel.status === "stale" ? staleNote(panel.fetchedAt, zone, now) : nothing}`
    }
  </section>`;
}

function header(location: SavedLocation) {
  const meta = location.nws;
  return html`<section class="card stack loc-detail-head">
    <h2>${location.name}</h2>
    <p class="muted">${meta ? html`${meta.city}, ${meta.state} · ` : nothing}${location.lat}, ${location.lon}</p>
    <nav class="button-row" aria-label="Location">
      <a class="btn btn-secondary" href=${routeHref({ name: "dashboard" })}>Back to Dashboard</a>
      ${
        meta?.cwa
          ? html`<a class="btn btn-secondary" href=${routeHref({ name: "discussion", id: location.id })}>Forecast discussion</a>`
          : nothing
      }
    </nav>
  </section>`;
}

export function locationView(props: LocationViewProps): TemplateResult {
  const { location, detail, now, online } = props;
  if (!location) {
    return html`
      <section class="card">
        <h2>Location not found</h2>
        <p>That location isn't in your saved list. It may have been deleted.</p>
        <a href=${routeHref({ name: "manage" })}>Go to Locations</a>
      </section>
    `;
  }
  const zone = location.nws?.timeZone ?? deviceZone();
  return html`
    <div class="stack">
      ${header(location)}
      <div class="two-col">
        <div class="stack">
          ${alertsSection(detail.alerts, zone, now)}
          ${currentSection(detail.current, zone, now)}
          ${radarSection(location.nws, online)}
        </div>
        <div class="stack">
          ${forecastSection(detail.forecast, zone, now)}
          ${hourlySection(detail.hourly, zone, now)}
        </div>
      </div>
    </div>
  `;
}
