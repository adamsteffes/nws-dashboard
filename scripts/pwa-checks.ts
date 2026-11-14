// Pure matching helpers for scripts/check-pwa-build.ts, split out so they can be unit tested.
const RUNTIME_STRATEGIES =
  /NetworkFirst|CacheFirst|StaleWhileRevalidate|NetworkOnly/;
const EXTERNAL_HOSTS = ["api.weather.gov", "radar.weather.gov", "nominatim"];

/** Returns a list of problems with a generated sw.js (empty when it is the expected shell-only worker). */
export function serviceWorkerProblems(sw: string, base: string): string[] {
  const problems: string[] = [];
  if (!sw.includes('{url:"index.html"')) {
    problems.push("index.html is not in the precache manifest");
  }
  if (!sw.includes(`createHandlerBoundToURL("${base}index.html")`)) {
    problems.push(`navigation fallback is not bound to ${base}index.html`);
  }
  const strategy = RUNTIME_STRATEGIES.exec(sw);
  if (strategy) {
    problems.push(`sw.js contains runtime caching strategy ${strategy[0]}`);
  }
  // Precaching registers its own routes internally; the only explicit one allowed is the navigation fallback.
  const routes = sw.match(/registerRoute\(/g)?.length ?? 0;
  if (routes > 1) {
    problems.push(
      `sw.js registers ${routes} routes, expected only the navigation fallback`,
    );
  }
  for (const host of EXTERNAL_HOSTS) {
    if (sw.includes(host)) problems.push(`sw.js must not reference ${host}`);
  }
  return problems;
}

/** Maps a manifest icon src (relative or absolute under base) to a path inside dist. */
export function distPathForIcon(src: string, base: string): string {
  return src.startsWith(base)
    ? src.slice(base.length)
    : src.replace(/^\.?\//, "");
}
