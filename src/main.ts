import { render } from "lit-html";
import { createAppContext } from "./app/context";
import { createDashboardController } from "./app/dashboardController";
import { createDiscussionController } from "./app/discussionController";
import { createManageController } from "./app/manageController";
import "./styles/base.css";
import {
  currentInstallHintEnv,
  dismissInstallHint,
  installHintView,
  isStandalone,
  shouldShowInstallHint,
} from "./pwa/installHint";
import {
  dismissNeedRefresh,
  dismissOfflineReady,
  getPwaState,
  registerPwa,
  subscribePwa,
} from "./pwa/register";
import { updatePromptView } from "./pwa/updatePrompt";
import { createRouter, parseRoute, type Route, routeHref } from "./router";
import { dashboardView } from "./views/dashboard";
import { discussionView } from "./views/discussion";
import { layoutView } from "./views/layout";
import { locationView } from "./views/location";
import { manageView } from "./views/manage";
import { notFoundView } from "./views/notFound";

const APP_NAME = "NWS Weather";

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("#app element not found");
}
const root: HTMLElement = app;

const ctx = createAppContext();
const manage = createManageController(ctx, { onChange: () => update() });
const dashboard = createDashboardController(ctx, { onChange: () => update() });
const discussion = createDiscussionController(ctx, {
  onChange: () => update(),
});

// Data older than this is reloaded when the dashboard is opened.
const DASHBOARD_MAX_AGE_MS = 5 * 60_000;

function pageTitle(route: Route): string {
  switch (route.name) {
    case "dashboard":
      return APP_NAME;
    case "location":
      return ctx.store.get(route.id)?.name ?? "Location not found";
    case "discussion":
      return `Forecast discussion — ${ctx.store.get(route.id)?.name ?? route.id}`;
    case "manage":
      return "Locations";
    case "notFound":
      return "Page not found";
  }
}

function routeContent(route: Route) {
  switch (route.name) {
    case "dashboard":
      return dashboardView(dashboard.viewProps());
    case "location":
      return locationView(ctx.store.get(route.id));
    case "discussion":
      return discussionView(discussion.viewProps(), {
        onSections: (on) => discussion.setSections(on),
      });
    case "manage":
      return manageView(manage.viewProps());
    case "notFound":
      return notFoundView();
  }
}

let route = parseRoute(window.location.hash);
let installHintVisible = shouldShowInstallHint(currentInstallHintEnv());

function update() {
  const title = pageTitle(route);
  document.title =
    route.name === "dashboard" ? title : `${title} — ${APP_NAME}`;
  render(
    layoutView({
      route,
      title,
      online: dashboard.online,
      refreshing:
        route.name === "discussion"
          ? discussion.refreshing
          : dashboard.refreshing,
      onRefresh: () =>
        void (route.name === "discussion"
          ? discussion.refresh()
          : dashboard.load({ refresh: true })),
      content: routeContent(route),
      version: __APP_VERSION__,
      notices: updatePromptView({
        ...getPwaState(),
        // Avoid stacking two notices; the install hint takes priority.
        offlineReady: getPwaState().offlineReady && !installHintVisible,
        onReload: () => void getPwaState().update(),
        onLater: dismissNeedRefresh,
        onDismissOfflineReady: dismissOfflineReady,
      }),
      hint: installHintView({
        visible: installHintVisible,
        onDismiss: () => {
          dismissInstallHint();
          installHintVisible = false;
          update();
        },
      }),
    }),
    root,
  );
  // Template swaps (confirm rows, inline forms) drop focus; put it back.
  if (route.name === "manage") manage.applyFocus();
}

createRouter((next) => {
  const changed = routeHref(next) !== routeHref(route);
  // Stale confirms and messages from an earlier visit shouldn't greet the user.
  if (next.name === "manage" && route.name !== "manage") manage.reset();
  route = next;
  if (changed && next.name === "discussion") {
    void discussion.open(next.id, next.productId);
  }
  update();
  if (
    next.name === "dashboard" &&
    dashboard.isOlderThan(DASHBOARD_MAX_AGE_MS)
  ) {
    void dashboard.load();
  }
  if (changed) {
    // Screen readers get no page load, so announce the new page by focusing its heading.
    document.querySelector<HTMLElement>("#page-title")?.focus();
  }
});

window.addEventListener("online", () => {
  dashboard.setOnline(true);
});
window.addEventListener("offline", () => {
  dashboard.setOnline(false);
});

// Also fires for changes made in another tab.
ctx.store.subscribe(update);

update();
if (route.name === "dashboard") void dashboard.load();
if (route.name === "discussion") {
  void discussion.open(route.id, route.productId);
}
subscribePwa(update);

// Ask the browser not to evict saved locations under storage pressure; the result is advisory.
// Only for the installed app: Firefox desktop shows a permission prompt for this call.
if (isStandalone()) {
  void Promise.resolve(navigator.storage?.persist?.()).catch(() => {});
}
void registerPwa();
