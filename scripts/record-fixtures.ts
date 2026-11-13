// Records live NWS API responses as test fixtures. Run via `npm run record-fixtures`.
// Only erasable TypeScript syntax is used so Node can run this file directly.
import { writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const API = "https://api.weather.gov";
const REPO_URL = "https://github.com/adamsteffes/nws-dashboard";
const DEFAULT_POINTS = [
  "39.7456,-97.0892:linn-ks",
  "25.7617,-80.1918:miami-fl",
];
const DEFAULT_OUT = "tests/fixtures/nws";
const BACKOFF_MS = [1000, 2000, 4000];
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 10_000;
const TIMEOUT_MS = 15_000;

// Only these response headers are persisted: no cookies or server identifiers.
const HEADER_WHITELIST = [
  "cache-control",
  "expires",
  "date",
  "content-type",
  "access-control-allow-origin",
  "access-control-allow-headers",
  "access-control-expose-headers",
  "x-correlation-id",
];

export type Point = { lat: number; lon: number; label: string };
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
export type WriteFn = (path: string, data: string) => Promise<void>;

export type Sidecar = {
  url: string;
  status: number;
  headers: Record<string, string>;
};

type Fetched = {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  // undefined when the body was missing or not JSON.
  body: unknown;
};

export type RecordResult = {
  ok: boolean;
  files: string[];
  failures: string[];
  coreFailures: string[];
  findings: string;
};

export function roundCoord(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export function parsePointArg(arg: string): Point {
  const sep = arg.indexOf(":");
  const coords = sep === -1 ? arg : arg.slice(0, sep);
  const rawLabel = sep === -1 ? "" : arg.slice(sep + 1);
  const parts = coords.split(",");
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (
    parts.length !== 2 ||
    parts.some((p) => p.trim() === "") ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    throw new Error(`Invalid point "${arg}": expected lat,lon[:label]`);
  }
  const rlat = roundCoord(lat);
  const rlon = roundCoord(lon);
  // Labels become file names, so restrict them to a safe alphabet.
  const label = rawLabel === "" ? `${rlat}_${rlon}` : rawLabel;
  if (!/^[A-Za-z0-9_.-]+$/.test(label) || label.startsWith(".")) {
    throw new Error(
      `Invalid label "${label}" in "${arg}": use letters, digits, - _ .`,
    );
  }
  return { lat: rlat, lon: rlon, label: label.toLowerCase() };
}

export function fixtureName(
  kind: string,
  label: string,
  station?: string,
): string {
  return station ? `${kind}_${label}_${station}` : `${kind}_${label}`;
}

export function pickHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of HEADER_WHITELIST) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

export function buildUserAgent(contact?: string): string {
  const base = `nws-dashboard-fixture-recorder (${REPO_URL})`;
  return contact ? `${base}; ${contact}` : base;
}

export function summarizeFindings(info: {
  pointsHeaders?: Record<string, string>;
  cacheControl: Record<string, string[]>;
  afdId?: string;
}): string {
  const acao = info.pointsHeaders?.["access-control-allow-origin"];
  const lines = [
    acao === undefined
      ? "- `access-control-allow-origin` was NOT present on the points response."
      : `- \`access-control-allow-origin\` present on the points response: \`${acao}\``,
    "- `cache-control` values seen per endpoint type:",
  ];
  const types = Object.keys(info.cacheControl).sort();
  if (types.length === 0) lines.push("  - (none recorded)");
  for (const type of types) {
    const values = info.cacheControl[type] ?? [];
    lines.push(`  - ${type}: ${values.map((v) => `\`${v}\``).join(", ")}`);
  }
  lines.push(
    `- AFD product id used: ${info.afdId ? `\`${info.afdId}\`` : "(none)"}`,
  );
  return lines.join("\n");
}

function retryDelay(res: Response | undefined, attempt: number): number {
  const base = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 1000;
  const retryAfter = Number(res?.headers.get("retry-after"));
  if (res && Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
  }
  return base;
}

export async function record(opts: {
  points: Point[];
  outDir: string;
  fetchFn: FetchFn;
  writeFile: WriteFn;
  now: () => Date;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
  log?: (msg: string) => void;
}): Promise<RecordResult> {
  const { points, outDir, fetchFn, writeFile, now } = opts;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => {});
  const requestInit = (): RequestInit => ({
    headers: {
      Accept: "application/geo+json",
      "User-Agent": opts.userAgent ?? buildUserAgent(process.env.NWS_CONTACT),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const files: string[] = [];
  const failures: string[] = [];
  const coreFailures: string[] = [];
  const cacheControl: Record<string, string[]> = {};
  let pointsHeaders: Record<string, string> | undefined;
  let afdId: string | undefined;

  async function write(file: string, data: string) {
    await writeFile(join(outDir, file), data);
    files.push(file);
  }

  async function fetchWithRetry(url: string): Promise<Fetched> {
    let last: Fetched | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let res: Response | undefined;
      try {
        res = await fetchFn(url, requestInit());
        const text = await res.text();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          body = undefined;
        }
        last = {
          url,
          status: res.status,
          ok: res.ok,
          headers: pickHeaders(res.headers),
          body,
        };
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable) return last;
      } catch (err) {
        log(`  ${url}: ${err instanceof Error ? err.message : String(err)}`);
        last = { url, status: 0, ok: false, headers: {}, body: undefined };
      }
      if (attempt < MAX_ATTEMPTS - 1) {
        const delay = retryDelay(res, attempt);
        log(
          `  ${url}: attempt ${attempt + 1} failed (status ${last.status}), retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
    return last as Fetched;
  }

  // Fetches, records body + sidecar, and returns the parsed body on success.
  async function capture(
    type: string,
    name: string,
    url: string,
    core: boolean,
  ): Promise<{ body: unknown; headers: Record<string, string> } | undefined> {
    const res = await fetchWithRetry(url);
    if (res.body !== undefined)
      await write(`${name}.json`, `${JSON.stringify(res.body, null, 2)}\n`);
    const sidecar: Sidecar = { url, status: res.status, headers: res.headers };
    await write(
      `${name}.headers.json`,
      `${JSON.stringify(sidecar, null, 2)}\n`,
    );
    if (!res.ok) {
      log(`FAILED ${name}: ${url} -> ${res.status}`);
      failures.push(name);
      if (core) coreFailures.push(name);
      return undefined;
    }
    log(`ok ${name}: ${res.status}`);
    const cc = res.headers["cache-control"];
    if (cc !== undefined) {
      const seen = cacheControl[type] ?? [];
      if (!seen.includes(cc)) seen.push(cc);
      cacheControl[type] = seen;
    }
    return { body: res.body, headers: res.headers };
  }

  function fail(name: string, core: boolean, reason: string) {
    log(`FAILED ${name}: ${reason}`);
    failures.push(name);
    if (core) coreFailures.push(name);
  }

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v ? v : undefined;
  const rec = (v: unknown): Record<string, unknown> =>
    typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

  for (const p of points) {
    log(`Point ${p.label} (${p.lat},${p.lon})`);
    const L = p.label;
    const pts = await capture(
      "points",
      fixtureName("points", L),
      `${API}/points/${p.lat},${p.lon}`,
      true,
    );
    if (pts) pointsHeaders ??= pts.headers;
    const props = rec(rec(pts?.body).properties);

    const forecastUrl = str(props.forecast);
    if (forecastUrl)
      await capture("forecast", fixtureName("forecast", L), forecastUrl, true);
    else fail(fixtureName("forecast", L), true, "no forecast URL from points");

    const hourlyUrl = str(props.forecastHourly);
    if (hourlyUrl)
      await capture(
        "forecast_hourly",
        fixtureName("forecast_hourly", L),
        hourlyUrl,
        true,
      );
    else
      fail(
        fixtureName("forecast_hourly", L),
        true,
        "no forecastHourly URL from points",
      );

    const stationsUrl = str(props.observationStations);
    if (stationsUrl) {
      const st = await capture(
        "stations",
        fixtureName("stations", L),
        stationsUrl,
        false,
      );
      const features = rec(st?.body).features;
      const ids = (Array.isArray(features) ? features : [])
        .map((f) => str(rec(rec(f).properties).stationIdentifier))
        .filter((id): id is string => id !== undefined)
        .slice(0, 2);
      for (const id of ids) {
        await capture(
          "observations_latest",
          fixtureName("obs_latest", L, id),
          `${API}/stations/${id}/observations/latest`,
          false,
        );
      }
    } else
      fail(
        fixtureName("stations", L),
        false,
        "no observationStations URL from points",
      );

    await capture(
      "alerts_active",
      fixtureName("alerts_active", L),
      `${API}/alerts/active?point=${p.lat},${p.lon}`,
      true,
    );

    const cwa = str(props.cwa) ?? str(props.gridId);
    if (cwa) {
      const list = await capture(
        "products_list",
        fixtureName("afd_list", L),
        `${API}/products/types/AFD/locations/${cwa}`,
        false,
      );
      const graph = rec(list?.body)["@graph"];
      const id = str(rec(Array.isArray(graph) ? graph[0] : undefined).id);
      if (id) {
        afdId ??= id;
        await capture(
          "products",
          fixtureName("afd_product", L),
          `${API}/products/${id}`,
          false,
        );
      } else if (list)
        fail(fixtureName("afd_product", L), false, "no AFD product in list");
    } else fail(fixtureName("afd_list", L), false, "no cwa from points");
  }

  const findings = summarizeFindings({ pointsHeaders, cacheControl, afdId });
  const md = [
    "# Recorded NWS fixtures",
    "",
    `Recorded: ${now().toISOString()} (UTC)`,
    "",
    "## Points",
    "",
    ...points.map((p) => `- ${p.label}: ${p.lat},${p.lon}`),
    "",
    "## Files",
    "",
    ...[...files, "RECORDED.md"].sort().map((f) => `- ${f}`),
    "",
    "## Findings",
    "",
    findings,
    "",
  ].join("\n");
  await write("RECORDED.md", md);

  return {
    ok: coreFailures.length === 0,
    files,
    failures,
    coreFailures,
    findings,
  };
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { out: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    console.log(
      `Usage: node scripts/record-fixtures.ts [--out DIR] [lat,lon[:label] ...]\n` +
        `Defaults: --out ${DEFAULT_OUT}; points ${DEFAULT_POINTS.join(" ")}\n` +
        `Set NWS_CONTACT to append contact info to the User-Agent.`,
    );
    return 0;
  }
  const points = (positionals.length > 0 ? positionals : DEFAULT_POINTS).map(
    parsePointArg,
  );
  const result = await record({
    points,
    outDir: values.out ?? DEFAULT_OUT,
    fetchFn: (url, init) => fetch(url, init),
    writeFile: async (path, data) => {
      await mkdir(dirname(path), { recursive: true });
      await fsWriteFile(path, data);
    },
    now: () => new Date(),
    log: (msg) => console.log(msg),
  });
  if (!result.ok) {
    console.error(`Core resources failed: ${result.coreFailures.join(", ")}`);
    return 1;
  }
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}
