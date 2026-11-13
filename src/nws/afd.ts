import type { Fetched, NwsClient } from "./client";

const BASE = "https://api.weather.gov";

export type ProductRef = {
  id: string;
  issuanceTime: string;
  issuingOffice: string;
};

export type Product = {
  id: string;
  issuanceTime: string;
  issuingOffice: string;
  productName: string;
  text: string;
};

type FetchOpts = { refresh?: boolean };
type ListOpts = FetchOpts & { limit?: number };

const DEFAULT_LIMIT = 6;

// Accepts a 3-character WFO id ("TOP") or its 4-character ICAO form ("KTOP",
// "PHFO", "TJSJ"); the products API only knows the 3-character form.
export function afdListUrl(cwa: string): string {
  let code = cwa.trim().toUpperCase();
  if (/^[KPT][A-Z0-9]{3}$/.test(code)) code = code.slice(1);
  if (!/^[A-Z0-9]{3}$/.test(code)) {
    throw new RangeError(`Invalid NWS office code: ${JSON.stringify(cwa)}`);
  }
  return `${BASE}/products/types/AFD/locations/${code}`;
}

export function productUrl(id: string): string {
  if (id === "" || id === "." || id === ".." || id.includes("/")) {
    throw new RangeError(`Invalid product id: ${JSON.stringify(id)}`);
  }
  return `${BASE}/products/${encodeURIComponent(id)}`;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

// The API sends offsets, but a time without one is read as UTC rather than
// the viewer's local time. Date-only values are already UTC in ECMAScript.
const timeOf = (iso: string): number => {
  const value = iso.trim();
  const zoned = /T.*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value);
  return Date.parse(value.includes("T") && !zoned ? `${value}Z` : value);
};

// Newest first, with entries that lack an id or a usable time dropped.
function parseAllRefs(json: unknown): ProductRef[] {
  const graph = asRecord(json)["@graph"];
  if (!Array.isArray(graph)) return [];
  const refs: ProductRef[] = [];
  for (const entry of graph) {
    const record = asRecord(entry);
    const id = str(record.id);
    const issuanceTime = str(record.issuanceTime);
    if (!id || !issuanceTime || Number.isNaN(timeOf(issuanceTime))) continue;
    refs.push({
      id,
      issuanceTime,
      issuingOffice: str(record.issuingOffice) ?? "",
    });
  }
  // The API says newest first, but the order is not part of its contract.
  return refs.sort((a, b) => timeOf(b.issuanceTime) - timeOf(a.issuanceTime));
}

const sliceLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : DEFAULT_LIMIT;

export function parseProductList(
  json: unknown,
  limit = DEFAULT_LIMIT,
): ProductRef[] {
  return parseAllRefs(json).slice(0, sliceLimit(limit));
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

export function parseProduct(json: unknown): Product {
  const record = asRecord(json);
  const id = str(record.id);
  if (!id) throw new Error("Product response has no id");
  const text = str(record.productText);
  if (text === undefined) {
    throw new Error(`Product ${id} has no productText`);
  }
  return {
    id,
    issuanceTime: str(record.issuanceTime) ?? "",
    issuingOffice: str(record.issuingOffice) ?? "",
    productName: str(record.productName) ?? "",
    text: normalizeText(text),
  };
}

export async function fetchAfdList(
  client: NwsClient,
  cwa: string,
  opts: ListOpts = {},
): Promise<Fetched<ProductRef[]>> {
  const res = await client.getJson(afdListUrl(cwa), {
    refresh: opts.refresh,
  });
  return { ...res, data: parseProductList(res.data, opts.limit) };
}

export async function fetchProduct(
  client: NwsClient,
  id: string,
  opts: FetchOpts = {},
): Promise<Fetched<Product>> {
  const res = await client.getJson(productUrl(id), { refresh: opts.refresh });
  return { ...res, data: parseProduct(res.data) };
}

const MAX_PRODUCT_ATTEMPTS = 3;

/**
 * Fetches the list, then the newest discussion. If that product cannot be
 * fetched, older ones are tried (at most 3 requests) so a cached discussion
 * can still be shown; `error` is set only when none succeeded. Only a failing
 * list fetch rejects. `limit` shapes `list` but never what counts as latest.
 */
export async function fetchLatestAfd(
  client: NwsClient,
  cwa: string,
  opts: ListOpts = {},
): Promise<{
  list: Fetched<ProductRef[]>;
  latest: Fetched<Product> | null;
  error?: unknown;
}> {
  const raw = await client.getJson(afdListUrl(cwa), {
    refresh: opts.refresh,
  });
  const all = parseAllRefs(raw.data);
  const list = {
    ...raw,
    data: all.slice(0, sliceLimit(opts.limit ?? DEFAULT_LIMIT)),
  };
  let error: unknown;
  for (const ref of all.slice(0, MAX_PRODUCT_ATTEMPTS)) {
    try {
      const latest = await fetchProduct(client, ref.id, {
        refresh: opts.refresh,
      });
      return { list, latest };
    } catch (e) {
      error = e;
    }
  }
  return error === undefined
    ? { list, latest: null }
    : { list, latest: null, error };
}

export type AfdSection = { title: string | null; body: string };

const HEADER = /^\.([A-Z][^\n]*?)\.\.\.\s*$/;
const SEPARATOR = /^&&\s*$/;

/** Splits AFD text at `.TITLE...` headers; `&&` lines only end a section. */
export function splitSections(text: string): AfdSection[] {
  const sections: AfdSection[] = [];
  let title: string | null = null;
  let lines: string[] = [];

  const flush = () => {
    const body = lines.join("\n").replace(/^\n+|\n+$/g, "");
    if (title !== null || body !== "") sections.push({ title, body });
    lines = [];
  };

  for (const line of text.split("\n")) {
    const header = HEADER.exec(line);
    if (header) {
      flush();
      title = (header[1] ?? "").trim();
    } else if (SEPARATOR.test(line)) {
      flush();
      title = null;
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}
