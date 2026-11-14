import { describe, expect, it } from "vitest";
import { CONUS_LOOP, radarUrls } from "../../src/nws/radar";

describe("radarUrls", () => {
  it("builds still, loop and page URLs", () => {
    expect(radarUrls("KTWX")).toEqual({
      still: "https://radar.weather.gov/ridge/standard/KTWX_0.gif",
      loop: "https://radar.weather.gov/ridge/standard/KTWX_loop.gif",
      page: "https://radar.weather.gov/station/KTWX/standard",
    });
  });

  it("returns null for no station", () => {
    expect(radarUrls(null)).toBeNull();
  });

  it.each(["ktwx", "KTW", "KTWXX", "KT/X", "", "KTW "])(
    "rejects %j",
    (station) => {
      expect(radarUrls(station)).toBeNull();
    },
  );

  it("exposes the nationwide fallback", () => {
    expect(CONUS_LOOP).toBe(
      "https://radar.weather.gov/ridge/standard/CONUS_loop.gif",
    );
  });
});
