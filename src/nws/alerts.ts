import type { Fetched, NwsClient } from "./client";

export type Severity = "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";

export type Alert = {
  id: string;
  event: string;
  severity: Severity;
  certainty: string;
  urgency: string;
  headline: string | null;
  description: string;
  instruction: string | null;
  effective: string | null;
  onset: string | null;
  expires: string | null;
  ends: string | null;
  senderName: string;
  areaDesc: string;
};

const SEVERITY_RANK: Record<Severity, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const text = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

const SEVERITIES: Severity[] = ["Extreme", "Severe", "Moderate", "Minor"];

const toSeverity = (v: unknown): Severity =>
  (typeof v === "string" &&
    SEVERITIES.find((s) => s.toLowerCase() === v.trim().toLowerCase())) ||
  "Unknown";

const ID_PREFIX = "https://api.weather.gov/alerts/";

// Missing or unparseable times sort last among equals.
const startMs = (alert: Alert): number => {
  const ms = Date.parse(alert.onset ?? alert.effective ?? "");
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
};

function parseAlert(feature: unknown): Alert | null {
  if (!isRecord(feature)) return null;
  const props = isRecord(feature.properties) ? feature.properties : {};
  const featureId = text(feature.id);
  const id =
    text(props.id) ??
    (featureId?.startsWith(ID_PREFIX)
      ? featureId.slice(ID_PREFIX.length)
      : featureId);
  const event = text(props.event);
  if (!id || !event) return null;
  return {
    id,
    event,
    severity: toSeverity(props.severity),
    certainty: text(props.certainty) ?? "Unknown",
    urgency: text(props.urgency) ?? "Unknown",
    headline: text(props.headline),
    description: text(props.description) ?? "",
    instruction: text(props.instruction),
    effective: text(props.effective),
    onset: text(props.onset),
    expires: text(props.expires),
    ends: text(props.ends),
    senderName: text(props.senderName) ?? "",
    areaDesc: text(props.areaDesc) ?? "",
  };
}

export function parseAlerts(json: unknown): Alert[] {
  const features = isRecord(json) ? json.features : undefined;
  if (!Array.isArray(features)) return [];
  const alerts: Alert[] = [];
  for (const feature of features) {
    const alert = parseAlert(feature);
    if (alert) alerts.push(alert);
  }
  return alerts.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (bySeverity !== 0) return bySeverity;
    const [x, y] = [startMs(a), startMs(b)];
    // Subtracting two Infinity values would give NaN.
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

export function highestSeverity(alerts: Alert[]): Severity | null {
  let best: Severity | null = null;
  for (const alert of alerts) {
    if (best === null || SEVERITY_RANK[alert.severity] > SEVERITY_RANK[best]) {
      best = alert.severity;
    }
  }
  return best;
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export function alertsUrl(lat: number, lon: number): string {
  return `https://api.weather.gov/alerts/active?point=${round4(lat)},${round4(lon)}`;
}

export async function fetchAlerts(
  client: NwsClient,
  lat: number,
  lon: number,
  opts: { refresh?: boolean } = {},
): Promise<Fetched<Alert[]>> {
  const res = await client.getJson(alertsUrl(lat, lon), opts);
  return { ...res, data: parseAlerts(res.data) };
}
