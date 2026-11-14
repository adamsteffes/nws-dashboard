import { describe, expect, it } from "vitest";
import { parseCoord } from "../../src/app/coords";

describe("parseCoord", () => {
  it.each([
    ["39.7456", "lat", 39.7456],
    ["-97.0892", "lon", -97.0892],
    ["+12.5", "lat", 12.5],
    ["  39.7456  ", "lat", 39.7456],
    ["39,7456", "lat", 39.7456],
    ["5", "lat", 5],
    ["5.", "lat", 5],
    [".5", "lat", 0.5],
    ["0", "lon", 0],
    // U+2212 minus sign and U+2013 en dash, as typed by smart punctuation.
    ["−97.08", "lon", -97.08],
    ["–97.08", "lon", -97.08],
    ["97.08 W", "lon", -97.08],
    ["97.08W", "lon", -97.08],
    ["w 97.08", "lon", -97.08],
    ["97.08 E", "lon", 97.08],
    ["39.75 N", "lat", 39.75],
    ["39.75 S", "lat", -39.75],
    ["S39.75", "lat", -39.75],
    ["97.08° W", "lon", -97.08],
  ] as const)("accepts %j as %s", (text, axis, expected) => {
    expect(parseCoord(text, axis)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "abc",
    "0x1A",
    "0x10",
    "1e1",
    "1e+1",
    "1_000",
    "Infinity",
    "NaN",
    "1.2.3",
    "1,2,3",
    "--5",
    "- 5",
    "-97 W",
    "N",
    "W 97 W",
    "12 34",
  ])("rejects %j", (text) => {
    expect(parseCoord(text, "lon")).toBeNaN();
    expect(parseCoord(text, "lat")).toBeNaN();
  });

  it("rejects hemisphere letters from the other axis", () => {
    expect(parseCoord("39 E", "lat")).toBeNaN();
    expect(parseCoord("39 W", "lat")).toBeNaN();
    expect(parseCoord("97 N", "lon")).toBeNaN();
    expect(parseCoord("97 S", "lon")).toBeNaN();
  });
});
