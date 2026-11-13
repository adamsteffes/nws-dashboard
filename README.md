# NWS Weather Dashboard

A static progressive web app that shows National Weather Service forecast and alert data in a clean dashboard, designed mainly for iPad Safari. There is no server: everything runs in the browser and is hosted on GitHub Pages.

Live: https://adamsteffes.github.io/nws-dashboard/

## Use it on your iPad

Open the live URL in Safari. Home Screen install support comes in a later step.

## Development

Requires Node 24 (see `.nvmrc`; Node 22.12+ works).

```sh
npm ci            # install dependencies
npm run dev       # start the dev server
npm test          # run unit tests
npm run test:e2e  # run browser tests (needs Playwright browsers)
npm run lint      # Biome lint + format check
npm run build     # type-check and build to dist/
```

## One-time GitHub setup

In the repository, go to Settings → Pages → Build and deployment → Source and choose **GitHub Actions**. Pushes to `main` then deploy automatically.

## Project status

- [x] Step 1: project scaffold and CI
- [x] Step 2: GitHub Pages deployment
- [x] Step 3: recorded API fixtures and fixture recorder
- [x] Step 4: Playwright browser tests and live API probe

## Test data

Unit tests use recorded NWS API responses and a few hand-written edge cases. See [tests/fixtures/README.md](tests/fixtures/README.md) for how they are produced and re-recorded.

## Browser tests

Playwright tests in `e2e/` run on every PR in the `e2e` CI job against the production build, in three projects: iPad Pro 11 portrait and landscape (WebKit) and desktop Chromium. All external hosts (api.weather.gov, radar.weather.gov, Nominatim) are mocked, and a test fails if the app requests any other external host. Each smoke test attaches light and dark full-page screenshots; download the `playwright-report` artifact from the workflow run and open `index.html` to see them.

Locally, install browsers once with `npx playwright install webkit chromium`, then `npm run test:e2e`.

### Live checks

`e2e/live/` holds a probe that calls the real NWS, radar and Nominatim services from the app's own origin to verify CORS, cache headers and radar image loading. It is not part of the PR run. To run it, open the Actions tab, choose **Live checks**, and click **Run workflow**; it also runs weekly. Findings appear in the run summary and in the `playwright-report` artifact. Locally: `npm run test:e2e:live`.
