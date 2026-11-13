import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:4173/nws-dashboard/";
const isCI = Boolean(process.env.CI);
const includeLive = process.env.LIVE === "1";

export default defineConfig({
  testDir: "e2e",
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: isCI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
  projects: includeLive
    ? [
        {
          // Real network; run on demand only (see test:e2e:live).
          name: "live",
          testMatch: /live\/.*\.live\.spec\.ts/,
          use: { ...devices["iPad Pro 11"] },
        },
      ]
    : [
        {
          name: "webkit-ipad-portrait",
          testIgnore: /live\//,
          use: { ...devices["iPad Pro 11"] },
        },
        {
          name: "webkit-ipad-landscape",
          testIgnore: /live\//,
          use: { ...devices["iPad Pro 11 landscape"] },
        },
        {
          name: "chromium-desktop",
          testIgnore: /live\//,
          use: { ...devices["Desktop Chrome"] },
        },
      ],
});
