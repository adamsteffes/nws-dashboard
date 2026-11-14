// Verifies the PWA output of `npm run build`. Run with `npm run check:pwa`.
import { existsSync, readFileSync } from "node:fs";
import { distPathForIcon, serviceWorkerProblems } from "./pwa-checks.ts";

const BASE = "/nws-dashboard/";
const dist = new URL("../dist/", import.meta.url);
const errors: string[] = [];

function check(condition: boolean, message: string) {
  if (!condition) errors.push(message);
}

function read(name: string): string | undefined {
  const url = new URL(name, dist);
  if (!existsSync(url)) {
    errors.push(`dist/${name} is missing (run npm run build first)`);
    return undefined;
  }
  return readFileSync(url, "utf-8");
}

interface Manifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  id?: string;
  display?: string;
  icons?: { src: string; sizes: string; type: string; purpose?: string }[];
}

const manifestText = read("manifest.webmanifest");
if (manifestText) {
  const manifest = JSON.parse(manifestText) as Manifest;
  check(manifest.name === "NWS Weather", "manifest name");
  check(manifest.short_name === "Weather", "manifest short_name");
  check(manifest.start_url === BASE, `manifest start_url is not ${BASE}`);
  check(manifest.scope === BASE, `manifest scope is not ${BASE}`);
  check(manifest.id === BASE, `manifest id is not ${BASE}`);
  check(manifest.display === "standalone", "manifest display");
  const icons = manifest.icons ?? [];
  for (const [sizes, purpose] of [
    ["192x192", undefined],
    ["512x512", undefined],
    ["512x512", "maskable"],
  ] as const) {
    check(
      icons.some((i) => i.sizes === sizes && i.purpose === purpose),
      `manifest icon ${sizes} ${purpose ?? "any"} missing`,
    );
  }
  for (const icon of icons) {
    check(
      existsSync(new URL(distPathForIcon(icon.src, BASE), dist)),
      `icon ${icon.src} not in dist`,
    );
  }
}

const sw = read("sw.js");
if (sw) {
  errors.push(...serviceWorkerProblems(sw, BASE));
}

const indexHtml = read("index.html");
if (indexHtml) {
  for (const href of [
    `${BASE}manifest.webmanifest`,
    `${BASE}apple-touch-icon-180x180.png`,
    `${BASE}icon.svg`,
    `${BASE}favicon.ico`,
  ]) {
    check(
      indexHtml.includes(`href="${href}"`),
      `index.html lacks href ${href}`,
    );
  }
  check(
    /rel="manifest"/.test(indexHtml),
    "index.html does not link the manifest",
  );
}

if (errors.length > 0) {
  console.error(`PWA build check failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log("PWA build check passed");
