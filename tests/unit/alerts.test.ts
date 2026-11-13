import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alertsUrl,
  fetchAlerts,
  highestSeverity,
  parseAlerts,
} from "../../src/nws/alerts";
import { createNwsClient } from "../../src/nws/client";
import type { LastGood } from "../../src/store/lastGood";
import { createFakeFetch } from "../helpers/fakeFetch";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "fixtures", "nws", `${name}.json`),
      "utf-8",
    ),
  );

const feature = (props: Record<string, unknown>) => ({
  properties: { id: "a", event: "Test Event", ...props },
});

describe("parseAlerts", () => {
  it("sorts by severity, then onset", () => {
    const alerts = parseAlerts(fixture("alerts_active_multi"));
    expect(alerts.map((a) => a.event)).toEqual([
      "Tornado Warning",
      "Winter Weather Advisory",
      "Frost Advisory",
    ]);
    expect(alerts.map((a) => a.severity)).toEqual([
      "Extreme",
      "Moderate",
      "Minor",
    ]);
  });

  it("preserves nulls and plain-text content verbatim", () => {
    const [tornado, winter, frost] = parseAlerts(
      fixture("alerts_active_multi"),
    );
    expect(winter?.instruction).toBeNull();
    expect(winter?.ends).toBeNull();
    expect(frost?.instruction).toBe(
      "Take steps now to protect tender plants from the cold.",
    );
    expect(tornado?.description).toContain('<script>alert("x")</script>');
    expect(tornado).toMatchObject({
      id: "urn:oid:2.49.0.1.840.0.test2",
      senderName: "NWS Topeka KS",
      areaDesc: "Washington; Marshall",
      certainty: "Observed",
      urgency: "Immediate",
    });
  });

  it.each(["alerts_empty", "alerts_active_linn-ks", "alerts_active_miami-fl"])(
    "returns [] for %s",
    (name) => {
      expect(parseAlerts(fixture(name))).toEqual([]);
    },
  );

  it("returns [] for malformed input", () => {
    expect(parseAlerts(null)).toEqual([]);
    expect(parseAlerts({ features: "nope" })).toEqual([]);
  });

  it("maps unknown severity to Unknown and ranks it last", () => {
    const alerts = parseAlerts({
      features: [
        feature({ id: "x", severity: "Catastrophic" }),
        feature({ id: "y", severity: "Minor" }),
        feature({ id: "z" }),
      ],
    });
    expect(alerts.map((a) => [a.id, a.severity])).toEqual([
      ["y", "Minor"],
      ["x", "Unknown"],
      ["z", "Unknown"],
    ]);
  });

  it("orders equal severities by onset, falling back to effective", () => {
    const alerts = parseAlerts({
      features: [
        feature({
          id: "late",
          severity: "Severe",
          onset: "2026-01-02T00:00:00Z",
        }),
        feature({
          id: "early",
          severity: "Severe",
          effective: "2026-01-01T00:00:00Z",
        }),
      ],
    });
    expect(alerts.map((a) => a.id)).toEqual(["early", "late"]);
  });

  it("skips features without an id or event", () => {
    const alerts = parseAlerts({
      features: [
        { properties: { event: "No Id" } },
        { properties: { id: "no-event" } },
        feature({ id: "ok" }),
      ],
    });
    expect(alerts.map((a) => a.id)).toEqual(["ok"]);
  });
});

describe("highestSeverity", () => {
  it("returns null for no alerts", () => {
    expect(highestSeverity([])).toBeNull();
  });

  it("returns the top-ranked severity", () => {
    expect(highestSeverity(parseAlerts(fixture("alerts_active_multi")))).toBe(
      "Extreme",
    );
    expect(
      highestSeverity(
        parseAlerts({
          features: [
            feature({ id: "a", severity: "Minor" }),
            feature({ id: "b", severity: "Severe" }),
          ],
        }),
      ),
    ).toBe("Severe");
  });
});

describe("fetchAlerts", () => {
  const noStore: LastGood = {
    async get() {
      return undefined;
    },
    async put() {},
    async prune() {},
    async deleteByPrefix() {},
    async clear() {},
  };

  it("rounds coordinates to 4 decimals in the URL", () => {
    expect(alertsUrl(39.745612, -97.089249)).toBe(
      "https://api.weather.gov/alerts/active?point=39.7456,-97.0892",
    );
  });

  it("requests the rounded URL and returns parsed alerts", async () => {
    const url = "https://api.weather.gov/alerts/active?point=39.7456,-97.0892";
    const fetchFn = createFakeFetch({
      [url]: { status: 200, body: fixture("alerts_active_multi") },
    });
    const client = createNwsClient({
      fetchFn,
      lastGood: noStore,
      isOnline: () => true,
    });
    const res = await fetchAlerts(client, 39.74561, -97.08921);
    expect(fetchFn.calls.map((c) => c.url)).toEqual([url]);
    expect(res.stale).toBe(false);
    expect(typeof res.fetchedAt).toBe("string");
    expect(res.data).toHaveLength(3);
    expect(res.data[0]?.severity).toBe("Extreme");
  });
});
