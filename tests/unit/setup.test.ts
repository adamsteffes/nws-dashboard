import { expect, it } from "vitest";

it("blocks fetch in unit tests", async () => {
  await expect(fetch("https://api.weather.gov/")).rejects.toThrow(
    "network disabled in unit tests",
  );
});
