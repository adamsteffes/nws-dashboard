const BASE = "https://radar.weather.gov";

/** Nationwide loop, used when a station's own image can't be loaded. */
export const CONUS_LOOP = `${BASE}/ridge/standard/CONUS_loop.gif`;

export type RadarUrls = { still: string; loop: string; page: string };

/** Image and page URLs for a radar station, or null when there is none to use. */
export function radarUrls(station: string | null): RadarUrls | null {
  // The id ends up in a URL, so only accept the shape NWS uses.
  if (station === null || !/^[A-Z0-9]{4}$/.test(station)) return null;
  return {
    still: `${BASE}/ridge/standard/${station}_0.gif`,
    loop: `${BASE}/ridge/standard/${station}_loop.gif`,
    page: `${BASE}/station/${station}/standard`,
  };
}
