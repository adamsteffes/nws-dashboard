# Test fixtures

## Recorded (`nws/*` except the hand-written files below)

Real responses from https://api.weather.gov, captured by `scripts/record-fixtures.ts`. Each body `name.json` has a sidecar `name.headers.json` with the URL, status and a whitelist of response headers (cache and CORS related). `nws/RECORDED.md` lists what was recorded, when, and findings such as whether the API sends `access-control-allow-origin`.

Never edit recorded files by hand. Re-record instead, so fixtures stay a faithful copy of the API.

## Hand-written edge cases

- `nws/obs_latest_nulls.json`: latest observation with every value null
- `nws/alerts_empty.json`: no active alerts
- `nws/alerts_active_multi.json`: three alerts in unsorted order, one with a `<script>` payload for XSS tests
- `nws/problem_500.json`, `nws/points_404.json`: `application/problem+json` error bodies
- `geocode/nominatim_*.json`: Nominatim `jsonv2`-style search results (not recorded)

## Re-recording

- GitHub Actions: run the "Record fixtures" workflow (optional `points` input, e.g. `39.7456,-97.0892:linn-ks`). It pushes a `fixtures/recorded-<run id>` branch; open a PR from it.
- Locally: `NWS_CONTACT=you@example.com npm run record-fixtures -- [lat,lon:label ...] [--out DIR]`

`NWS_CONTACT` is appended to the User-Agent so NWS can reach you; never commit an email address.
