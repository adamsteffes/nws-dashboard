export type Route =
  | { name: "dashboard" }
  | { name: "location"; id: string }
  | { name: "discussion"; id: string; productId?: string }
  | { name: "manage" }
  | { name: "notFound"; hash: string };

const ID_PATTERN = /^[a-z0-9-]{1,60}$/;
const PRODUCT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(hash: string): Route {
  return { name: "notFound", hash };
}

function decodeId(segment: string): string | undefined {
  try {
    const id = decodeURIComponent(segment);
    return ID_PATTERN.test(id) ? id : undefined;
  } catch {
    // Malformed percent-encoding.
    return undefined;
  }
}

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryStart = raw.indexOf("?");
  const rawPath = queryStart === -1 ? raw : raw.slice(0, queryStart);
  // Tolerate a single trailing slash ("#/manage/").
  const path =
    rawPath.length > 1 && rawPath.endsWith("/")
      ? rawPath.slice(0, -1)
      : rawPath;
  const query = queryStart === -1 ? "" : raw.slice(queryStart + 1);

  if (path === "" || path === "/") return { name: "dashboard" };
  if (path === "/manage") return { name: "manage" };

  const segments = path.split("/");
  // "/l/{id}" splits into ["", "l", id].
  if (segments[0] !== "" || segments[1] !== "l" || segments[2] === undefined) {
    return notFound(hash);
  }
  const id = decodeId(segments[2]);
  if (id === undefined) return notFound(hash);

  if (segments.length === 3) return { name: "location", id };
  if (segments.length === 4 && segments[3] === "afd") {
    const productId = new URLSearchParams(query).get("p");
    if (!productId) return { name: "discussion", id };
    return PRODUCT_ID_PATTERN.test(productId)
      ? { name: "discussion", id, productId }
      : notFound(hash);
  }
  return notFound(hash);
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case "dashboard":
      return "#/";
    case "location":
      return `#/l/${encodeURIComponent(route.id)}`;
    case "discussion": {
      const base = `#/l/${encodeURIComponent(route.id)}/afd`;
      return route.productId
        ? `${base}?p=${encodeURIComponent(route.productId)}`
        : base;
    }
    case "manage":
      return "#/manage";
    case "notFound":
      return route.hash;
  }
}

/**
 * Calls onChange with the current route whenever the hash changes; returns a stop function.
 * Hashes that are not routes (such as "#main" from in-page anchors) are ignored.
 */
export function createRouter(onChange: (route: Route) => void): () => void {
  const handler = () => {
    const { hash } = window.location;
    if (hash !== "" && hash !== "#" && !hash.startsWith("#/")) return;
    onChange(parseRoute(hash));
  };
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}
