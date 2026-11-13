import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "fixtures");

function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? jsonFiles(join(dir, e.name))
      : e.name.endsWith(".json")
        ? [join(dir, e.name)]
        : [],
  );
}

const load = (rel: string) =>
  JSON.parse(readFileSync(join(root, rel), "utf-8"));

describe("fixtures", () => {
  const files = jsonFiles(root);

  it("finds fixture files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s parses as JSON", (file) => {
    expect(() => JSON.parse(readFileSync(file, "utf-8"))).not.toThrow();
  });

  it.each(files.filter((f) => f.endsWith(".headers.json")))(
    "%s has status and headers",
    (file) => {
      const sidecar = JSON.parse(readFileSync(file, "utf-8"));
      expect(typeof sidecar.status).toBe("number");
      expect(typeof sidecar.headers).toBe("object");
    },
  );

  it("nulls observation has null values with unit codes", () => {
    const p = load("nws/obs_latest_nulls.json").properties;
    for (const key of [
      "temperature",
      "dewpoint",
      "windSpeed",
      "windGust",
      "barometricPressure",
      "visibility",
      "relativeHumidity",
      "heatIndex",
      "windChill",
    ]) {
      expect(p[key].value, key).toBeNull();
      expect(p[key].unitCode, key).toMatch(/^wmoUnit:/);
    }
    expect(p.textDescription).toBe("");
    expect(p.timestamp).toBeTruthy();
  });

  it("empty alerts has no features", () => {
    const fc = load("nws/alerts_empty.json");
    expect(fc.features).toEqual([]);
    expect(fc.title).toBeTruthy();
  });

  it("multi alerts has three unsorted alerts with nulls and XSS text", () => {
    const fc = load("nws/alerts_active_multi.json");
    const props = fc.features.map(
      (f: { properties: Record<string, unknown> }) => f.properties,
    );
    expect(props.map((p: { severity: string }) => p.severity)).toEqual([
      "Minor",
      "Extreme",
      "Moderate",
    ]);
    expect(
      props.some((p: { instruction: unknown }) => p.instruction === null),
    ).toBe(true);
    expect(props.some((p: { ends: unknown }) => p.ends === null)).toBe(true);
    expect(
      props.some((p: { description: string }) =>
        p.description.includes('<script>alert("x")</script>'),
      ),
    ).toBe(true);
  });

  it("problem fixtures have problem+json shape", () => {
    expect(load("nws/problem_500.json")).toMatchObject({
      status: 500,
      title: "Unexpected Problem",
    });
    expect(load("nws/points_404.json")).toMatchObject({
      status: 404,
      title: "Data Unavailable For Requested Point",
    });
  });

  it("geocode fixtures have expected result counts", () => {
    expect(
      load("geocode/nominatim_zip_66502.json").length,
    ).toBeGreaterThanOrEqual(1);
    expect(load("geocode/nominatim_boulder_co.json")).toHaveLength(2);
    expect(load("geocode/nominatim_none.json")).toEqual([]);
    const first = load("geocode/nominatim_zip_66502.json")[0];
    expect(typeof first.lat).toBe("string");
    expect(typeof first.lon).toBe("string");
  });
});
