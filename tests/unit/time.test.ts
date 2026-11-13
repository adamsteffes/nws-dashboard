import { describe, expect, it } from "vitest";
import { ageMinutes, formatAge, formatLocal } from "../../src/util/time";

const CHI = "America/Chicago";
const NYC = "America/New_York";

describe("formatLocal", () => {
  it.each([
    ["2026-11-13T15:00:00-06:00", CHI, "time", "3:00 PM"],
    ["2026-11-13T15:00:00-06:00", NYC, "time", "4:00 PM"],
    ["2026-11-13T15:00:00-06:00", CHI, "dayTime", "Fri 3:00 PM"],
    ["2026-11-13T15:00:00-06:00", CHI, "weekday", "Friday"],
    ["2026-11-13T15:00:00-06:00", CHI, "dateTime", "Nov 13, 3:00 PM"],
    ["2026-11-13T23:30:00-06:00", NYC, "weekday", "Saturday"],
    // 2026-11-01: clocks fall back at 2:00 CDT -> 1:00 CST, so 01:30 occurs twice.
    ["2026-11-01T01:30:00-05:00", CHI, "time", "1:30 AM"],
    ["2026-11-01T01:30:00-06:00", CHI, "time", "1:30 AM"],
    ["2026-11-01T06:30:00Z", CHI, "time", "1:30 AM"],
    ["2026-11-01T07:30:00Z", CHI, "time", "1:30 AM"],
    ["2026-11-01T08:30:00Z", CHI, "time", "2:30 AM"],
  ] as const)("%s in %s (%s) -> %s", (iso, tz, style, expected) => {
    expect(formatLocal(iso, tz, style)).toBe(expected);
  });

  it("distinguishes the two 01:30 instants on the DST change", () => {
    const cdt = new Date("2026-11-01T01:30:00-05:00").getTime();
    const cst = new Date("2026-11-01T01:30:00-06:00").getTime();
    expect(cst - cdt).toBe(3_600_000);
  });

  it.each(["", "not a date", "2026-13-45"])("returns a dash for %j", (iso) => {
    expect(formatLocal(iso, CHI, "time")).toBe("—");
  });
});

describe("ageMinutes", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  it.each([
    ["2026-11-13T12:00:00Z", 0],
    ["2026-11-13T11:59:30Z", 0],
    ["2026-11-13T11:55:00Z", 5],
    ["2026-11-13T11:54:01Z", 5],
    ["2026-11-13T09:55:00Z", 125],
    ["2026-11-13T06:00:00-06:00", 0],
    ["2026-11-13T12:05:00Z", 0],
    ["garbage", null],
    ["", null],
  ])("%s -> %s", (iso, expected) => {
    expect(ageMinutes(iso, now)).toBe(expected);
  });
});

describe("formatAge", () => {
  it.each([
    [null, "—"],
    [0, "just now"],
    [1, "1 min ago"],
    [5, "5 min ago"],
    [59, "59 min ago"],
    [60, "1 hr ago"],
    [125, "2 hr 5 min ago"],
    [120, "2 hr ago"],
  ])("%s -> %s", (minutes, expected) => {
    expect(formatAge(minutes)).toBe(expected);
  });
});
