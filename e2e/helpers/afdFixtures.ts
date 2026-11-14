import { readFileSync } from "node:fs";
import type { RouteHandler } from "./mockNetwork";

const fixture = (name: string): string =>
  readFileSync(
    new URL(`../../tests/fixtures/nws/${name}.json`, import.meta.url),
    "utf-8",
  );

const API = "https://api.weather.gov";
const LIST_URL = `${API}/products/types/AFD/locations/TOP`;

type Ref = { id: string; issuanceTime: string };

const refs = (JSON.parse(fixture("afd_list_linn-ks")) as { "@graph": Ref[] })[
  "@graph"
];

/** Newest first, as recorded. */
export const AFD_IDS = refs.map((ref) => ref.id);
export const AFD_NEWEST = AFD_IDS[0] as string;
export const AFD_OLDER = AFD_IDS[1] as string;
/** Distinct text for the older issuance, so tests can tell the two apart. */
export const AFD_OLDER_MARKER = "OLDER DISCUSSION MARKER";

export interface AfdControl {
  /** When set, the list request fails with this status. */
  listStatus: number | null;
}

/**
 * Answers the discussion list and products for Linn, KS. Only the newest
 * product is recorded; every other product is that text with a marker added.
 */
export function createAfdRoutes(next: RouteHandler): {
  handler: RouteHandler;
  control: AfdControl;
} {
  const control: AfdControl = { listStatus: null };
  const handler: RouteHandler = (route) => {
    const url = route.request().url();
    const headers = { "access-control-allow-origin": "*" };
    if (url === LIST_URL) {
      if (control.listStatus !== null) {
        return route.fulfill({
          status: control.listStatus,
          contentType: "application/problem+json",
          headers,
          body: JSON.stringify({ title: "Unavailable" }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/ld+json",
        headers,
        body: fixture("afd_list_linn-ks"),
      });
    }
    const id = url.startsWith(`${API}/products/`)
      ? url.slice(`${API}/products/`.length)
      : "";
    if (AFD_IDS.includes(id)) {
      const product = JSON.parse(fixture("afd_product_linn-ks")) as {
        id: string;
        productText: string;
      };
      const body =
        id === AFD_NEWEST
          ? product
          : {
              ...product,
              id,
              productText: `${AFD_OLDER_MARKER}\n\n${product.productText}`,
            };
      return route.fulfill({
        status: 200,
        contentType: "application/ld+json",
        headers,
        body: JSON.stringify(body),
      });
    }
    return next(route);
  };
  return { handler, control };
}
