import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetUnitWarnings,
  convert,
  cToF,
  degToCompass,
  kmhToMph,
  msToMph,
  mToMi,
  paToInHg,
  qv,
  round,
} from "../../src/nws/units";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  _resetUnitWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("qv", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string", "12"],
    ["number", 12],
    ["missing value", { unitCode: "wmoUnit:degC" }],
    ["null value", { unitCode: "wmoUnit:degC", value: null }],
    ["NaN value", { unitCode: "wmoUnit:degC", value: Number.NaN }],
    ["string value", { unitCode: "wmoUnit:degC", value: "1" }],
  ])("returns null for %s", (_name, input) => {
    expect(qv(input)).toBeNull();
  });

  it("reads value and unitCode", () => {
    expect(qv({ unitCode: "wmoUnit:degC", value: 0 })).toEqual({
      value: 0,
      unitCode: "wmoUnit:degC",
    });
  });

  it("defaults a missing unitCode to an empty string", () => {
    expect(qv({ value: 3 })).toEqual({ value: 3, unitCode: "" });
  });
});

describe("converters", () => {
  it.each([
    ["cToF", cToF, 0, 32],
    ["cToF", cToF, 100, 212],
    ["cToF", cToF, -40, -40],
    ["kmhToMph", kmhToMph, 100, 62.137],
    ["msToMph", msToMph, 10, 22.369],
    ["paToInHg", paToInHg, 101325, 29.92],
    ["mToMi", mToMi, 1609.344, 1],
  ])("%s(%d) ≈ %d", (_name, fn, input, expected) => {
    expect(fn(input)).toBeCloseTo(expected, 2);
  });
});

describe("convert", () => {
  it.each([
    ["wmoUnit:degC", 100, "degF", 212],
    ["degC", 0, "degF", 32],
    ["wmoUnit:degF", 70, "degF", 70],
    ["wmoUnit:km_h-1", 100, "mph", 62.137],
    ["wmoUnit:m_s-1", 10, "mph", 22.369],
    ["wmoUnit:Pa", 101325, "inHg", 29.92],
    ["wmoUnit:m", 1609.344, "mi", 1],
    ["wmoUnit:percent", 55, "percent", 55],
    ["wmoUnit:degree_(angle)", 270, "deg", 270],
  ] as const)("%s %d -> %s", (unitCode, value, target, expected) => {
    expect(convert({ unitCode, value }, target)).toBeCloseTo(expected, 2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null for a null value without warning", () => {
    expect(
      convert({ unitCode: "wmoUnit:degC", value: null }, "degF"),
    ).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null for non-objects", () => {
    expect(convert(undefined, "degF")).toBeNull();
  });

  it("warns once per unknown unitCode", () => {
    const q = { unitCode: "wmoUnit:furlong", value: 1 };
    expect(convert(q, "mi")).toBeNull();
    expect(convert(q, "mi")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    convert({ unitCode: "wmoUnit:other", value: 1 }, "mi");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("treats a mismatched unit as unknown", () => {
    expect(convert({ unitCode: "wmoUnit:Pa", value: 1 }, "degF")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("degToCompass", () => {
  it.each([
    [0, "N"],
    [11.24, "N"],
    [11.25, "NNE"],
    [90, "E"],
    [348.74, "NNW"],
    [348.75, "N"],
    [359.9, "N"],
    [360, "N"],
    [-22.5, "NNW"],
    [720, "N"],
  ])("%d -> %s", (deg, expected) => {
    expect(degToCompass(deg)).toBe(expected);
  });
});

describe("round", () => {
  it.each([
    [1.5, undefined, 2],
    [1.4, undefined, 1],
    [29.9234, 2, 29.92],
    [-0.4, 0, -0],
  ])("round(%d, %s) = %d", (n, digits, expected) => {
    expect(round(n, digits)).toBe(expected);
  });
});

describe("recorded observations", () => {
  const dir = join(import.meta.dirname, "..", "fixtures", "nws");
  const files = readdirSync(dir).filter(
    (f) =>
      f.startsWith("obs_latest_") &&
      f.endsWith(".json") &&
      !f.endsWith(".headers.json") &&
      !f.includes("nulls"),
  );
  const props = (f: string) =>
    JSON.parse(readFileSync(join(dir, f), "utf-8")).properties;

  it("finds fixtures", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s converts without warnings", (f) => {
    const p = props(f);
    for (const [key, target] of [
      ["temperature", "degF"],
      ["windSpeed", "mph"],
    ] as const) {
      const out = convert(p[key], target);
      expect(out === null || typeof out === "number").toBe(true);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("nulls fixture converts to all null", () => {
    const p = props("obs_latest_nulls.json");
    expect(convert(p.temperature, "degF")).toBeNull();
    expect(convert(p.windSpeed, "mph")).toBeNull();
    expect(convert(p.barometricPressure, "inHg")).toBeNull();
    expect(convert(p.windDirection, "deg")).toBeNull();
    expect(convert(p.relativeHumidity, "percent")).toBeNull();
    expect(convert(p.visibility, "mi")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
