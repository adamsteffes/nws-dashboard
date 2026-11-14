import {
  fetchAfdList,
  fetchLatestAfd,
  fetchProduct,
  type Product,
  type ProductRef,
} from "../nws/afd";
import type { Fetched } from "../nws/client";
import { describeFailure, type Panel } from "../services/panels";
import {
  resolveLocation,
  saveMetaIfUnchanged,
} from "../services/resolveLocation";
import type { SavedLocation } from "../store/locations";
import type { AppContext } from "./context";

export type DiscussionViewProps = {
  /** Undefined when the id is not a saved location. */
  location: SavedLocation | undefined;
  productId?: string;
  /** Recent issuances for the "Previous discussions" links. */
  list: Panel<ProductRef[]>;
  /** With status "ok" and no data, the office has published no discussion. */
  product: Panel<Product>;
  sections: boolean;
};

export type DiscussionController = {
  readonly refreshing: boolean;
  open(id: string, productId?: string): Promise<void>;
  /** Reloads what is open, bypassing the client's cache. */
  refresh(): Promise<void>;
  setSections(on: boolean): void;
  viewProps(): DiscussionViewProps;
};

export type DiscussionControllerOptions = {
  /** Called after every state change so the caller can re-render. */
  onChange: () => void;
};

function panelOf<T>(res: Fetched<T>): Panel<T> {
  return {
    status: res.stale ? "stale" : "ok",
    data: res.data,
    fetchedAt: res.fetchedAt,
  };
}

async function settle<T>(work: Promise<Fetched<T>>): Promise<Panel<T>> {
  try {
    return panelOf(await work);
  } catch (e) {
    return { status: "error", error: describeFailure(e) };
  }
}

export function createDiscussionController(
  ctx: AppContext,
  options: DiscussionControllerOptions,
): DiscussionController {
  const changed = options.onChange;
  let id: string | undefined;
  let productId: string | undefined;
  let list: Panel<ProductRef[]> = { status: "loading" };
  let product: Panel<Product> = { status: "loading" };
  let sections = false;
  let running = 0;
  /** Latest load; an older load's result is dropped. */
  let token = 0;

  async function cwaOf(location: SavedLocation): Promise<string> {
    if (location.nws) return location.nws.cwa;
    const meta = await resolveLocation(
      ctx.client,
      location.lat,
      location.lon,
      ctx.now(),
    );
    try {
      saveMetaIfUnchanged(ctx.store, location, meta);
    } catch {
      // Storage is read-only; this load can still use the meta.
    }
    return meta.cwa;
  }

  async function fetchPanels(
    location: SavedLocation,
    wantProduct: string | undefined,
    refresh: boolean,
  ): Promise<[Panel<ProductRef[]>, Panel<Product>]> {
    try {
      const cwa = await cwaOf(location);
      if (wantProduct !== undefined) {
        return await Promise.all([
          settle(fetchAfdList(ctx.client, cwa, { refresh })),
          settle(fetchProduct(ctx.client, wantProduct, { refresh })),
        ]);
      }
      const found = await fetchLatestAfd(ctx.client, cwa, { refresh });
      const latest: Panel<Product> = found.latest
        ? panelOf(found.latest)
        : found.error === undefined
          ? { status: "ok" }
          : { status: "error", error: describeFailure(found.error) };
      return [panelOf(found.list), latest];
    } catch (e) {
      const error = describeFailure(e);
      return [
        { status: "error", error },
        { status: "error", error },
      ];
    }
  }

  async function load(refresh: boolean): Promise<void> {
    const mine = ++token;
    const location = id === undefined ? undefined : ctx.store.get(id);
    if (!location) {
      changed();
      return;
    }
    running++;
    changed();
    try {
      const [nextList, nextProduct] = await fetchPanels(
        location,
        productId,
        refresh,
      );
      if (mine !== token) return;
      list = nextList;
      product = nextProduct;
    } finally {
      running--;
      changed();
    }
  }

  return {
    get refreshing() {
      return running > 0;
    },
    open(nextId, nextProductId) {
      id = nextId;
      productId = nextProductId;
      list = { status: "loading" };
      product = { status: "loading" };
      return load(false);
    },
    refresh() {
      return id === undefined ? Promise.resolve() : load(true);
    },
    setSections(on) {
      sections = on;
      changed();
    },
    viewProps() {
      const props: DiscussionViewProps = {
        location: id === undefined ? undefined : ctx.store.get(id),
        list,
        product,
        sections,
      };
      if (productId !== undefined) props.productId = productId;
      return props;
    },
  };
}
