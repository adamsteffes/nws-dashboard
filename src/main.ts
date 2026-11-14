import { render } from "lit-html";
import "./styles/base.css";
import {
  currentInstallHintEnv,
  dismissInstallHint,
  installHintView,
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

function pageTitle(route: Route): string {
  switch (route.name) {
    case "dashboard":
      return APP_NAME;
    case "location":
      return `Location ${route.id}`;
    case "discussion":
      return `Forecast discussion ${route.id}`;
    case "manage":
      return "Locations";
    case "notFound":
      return "Page not found";
  }
}

function routeContent(route: Route) {
  switch (route.name) {
    case "dashboard":
      return dashboardView();
    case "location":
      return locationView(route.id);
    case "discussion":
      return discussionView(route.id, route.productId);
    case "manage":
      return manageView();
    case "notFound":
      return notFoundView();
  }
}

let route = parseRoute(window.location.hash);
let online = navigator.onLine;
const refreshing = false;
let installHintVisible = shouldShowInstallHint(currentInstallHintEnv());

function update() {
  const title = pageTitle(route);
  document.title =
    route.name === "dashboard" ? title : `${title} — ${APP_NAME}`;
  render(
    layoutView({
      route,
      title,
      online,
      refreshing,
      // Data loading is wired in by later steps; for now refresh just re-renders.
      onRefresh: update,
      content: routeContent(route),
      version: __APP_VERSION__,
      notices: updatePromptView({
        ...getPwaState(),
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
}

createRouter((next) => {
  const changed = routeHref(next) !== routeHref(route);
  route = next;
  update();
  if (changed) {
    // Screen readers get no page load, so announce the new page by focusing its heading.
    document.querySelector<HTMLElement>("#page-title")?.focus();
  }
});

window.addEventListener("online", () => {
  online = true;
  update();
});
window.addEventListener("offline", () => {
  online = false;
  update();
});

update();
subscribePwa(update);

// Ask the browser not to evict saved locations under storage pressure; the result is advisory.
void Promise.resolve(navigator.storage?.persist?.()).catch(() => {});
void registerPwa();
