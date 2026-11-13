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
npm run lint      # Biome lint + format check
npm run build     # type-check and build to dist/
```

## One-time GitHub setup

In the repository, go to Settings → Pages → Build and deployment → Source and choose **GitHub Actions**. Pushes to `main` then deploy automatically.

## Project status

- [x] Step 1: project scaffold and CI
- [x] Step 2: GitHub Pages deployment
