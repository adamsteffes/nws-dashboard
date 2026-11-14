/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

const BASE = "/nws-dashboard/";

export default defineConfig({
  base: BASE,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    VitePWA({
      strategies: "generateSW",
      registerType: "prompt",
      // The manifest icons are already matched by globPatterns; skip the duplicate precache entries.
      includeManifestIcons: false,
      // Registered manually in src/pwa/register.ts so the update UI can hook in.
      injectRegister: false,
      manifest: {
        id: BASE,
        name: "NWS Weather",
        short_name: "Weather",
        description:
          "Forecasts, alerts and radar from the National Weather Service for your saved locations.",
        start_url: BASE,
        scope: BASE,
        display: "standalone",
        // Light tokens from src/styles/base.css (--surface for the theme, --bg behind the splash).
        theme_color: "#ffffff",
        background_color: "#f4f6f9",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // manifest.webmanifest is precached by the plugin itself, so it is not globbed here.
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Deliberately no runtimeCaching: api.weather.gov, radar.weather.gov and
        // nominatim responses are cached by the in-app client (memory + IndexedDB)
        // with its own freshness rules. A second cache here would serve stale
        // weather data behind its back. Only the app shell is precached.
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: "happy-dom",
    setupFiles: ["tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts"],
  },
});
