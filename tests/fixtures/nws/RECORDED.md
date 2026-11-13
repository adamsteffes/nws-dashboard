# Recorded NWS fixtures

Recorded: 2026-11-13T08:11:03.265Z (UTC)

## Points

- linn-ks: 39.7456,-97.0892
- miami-fl: 25.7617,-80.1918

## Files

- RECORDED.md
- afd_list_linn-ks.headers.json
- afd_list_linn-ks.json
- afd_list_miami-fl.headers.json
- afd_list_miami-fl.json
- afd_product_linn-ks.headers.json
- afd_product_linn-ks.json
- afd_product_miami-fl.headers.json
- afd_product_miami-fl.json
- alerts_active_linn-ks.headers.json
- alerts_active_linn-ks.json
- alerts_active_miami-fl.headers.json
- alerts_active_miami-fl.json
- forecast_hourly_linn-ks.headers.json
- forecast_hourly_linn-ks.json
- forecast_hourly_miami-fl.headers.json
- forecast_hourly_miami-fl.json
- forecast_linn-ks.headers.json
- forecast_linn-ks.json
- forecast_miami-fl.headers.json
- forecast_miami-fl.json
- obs_latest_linn-ks_KCNK.headers.json
- obs_latest_linn-ks_KCNK.json
- obs_latest_linn-ks_KMYZ.headers.json
- obs_latest_linn-ks_KMYZ.json
- obs_latest_miami-fl_KMIA.headers.json
- obs_latest_miami-fl_KMIA.json
- obs_latest_miami-fl_KOPF.headers.json
- obs_latest_miami-fl_KOPF.json
- points_linn-ks.headers.json
- points_linn-ks.json
- points_miami-fl.headers.json
- points_miami-fl.json
- stations_linn-ks.headers.json
- stations_linn-ks.json
- stations_miami-fl.headers.json
- stations_miami-fl.json

## Findings

- `access-control-allow-origin` present on the points response: `*`
- `cache-control` values seen per endpoint type:
  - alerts_active: `public, max-age=5, s-maxage=5`, `public, max-age=4, s-maxage=5`
  - forecast: `public, max-age=3600, s-maxage=3600`, `public, max-age=1588, s-maxage=3600`
  - forecast_hourly: `public, max-age=3600, s-maxage=3600`, `public, max-age=881, s-maxage=3600`
  - observations_latest: `public, max-age=300, s-maxage=300`, `public, max-age=274, s-maxage=300`, `public, max-age=152, s-maxage=300`
  - points: `public, max-age=76770, s-maxage=86400`, `public, max-age=35182, s-maxage=86400`
  - products: `public, max-age=120, s-maxage=120`
  - products_list: `public, max-age=120, s-maxage=120`
  - stations: `public, max-age=86400, s-maxage=86400`, `public, max-age=29297, s-maxage=86400`
- AFD product id used: `2504c4d3-ca29-45b4-b26c-04c683b807b9`
