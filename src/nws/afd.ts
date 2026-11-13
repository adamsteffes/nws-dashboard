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

export function afdListUrl(cwa: string): string {
  const code = cwa.trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(code)) {
    throw new RangeError(`Invalid NWS office code: ${JSON.stringify(cwa)}`);
  }
  return `${BASE}/products/types/AFD/locations/${code}`;
}

export function productUrl(id: string): string {
  return `${BASE}/products/${encodeURIComponent(id)}`;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

// Unparseable times sort last rather than throwing.
const timeOf = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

export function parseProductList(
  json: unknown,
  limit = DEFAULT_LIMIT,
): ProductRef[] {
  const graph = asRecord(json)["@graph"];
  if (!Array.isArray(graph)) return [];
  const refs: ProductRef[] = [];
  for (const entry of graph) {
    const record = asRecord(entry);
    const id = str(record.id);
    const issuanceTime = str(record.issuanceTime);
    if (!id || !issuanceTime) continue;
    refs.push({
      id,
      issuanceTime,
      issuingOffice: str(record.issuingOffice) ?? "",
    });
  }
  // The API says newest first, but the order is not part of its contract.
  refs.sort((a, b) => timeOf(b.issuanceTime) - timeOf(a.issuanceTime));
  return refs.slice(0, Math.max(0, limit));
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

export async function fetchLatestAfd(
  client: NwsClient,
  cwa: string,
  opts: ListOpts = {},
): Promise<{ list: Fetched<ProductRef[]>; latest: Fetched<Product> | null }> {
  const list = await fetchAfdList(client, cwa, opts);
  const first = list.data[0];
  if (!first) return { list, latest: null };
  const latest = await fetchProduct(client, first.id, {
    refresh: opts.refresh,
  });
  return { list, latest };
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
