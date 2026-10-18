import { describe, it, expect } from "vitest";
import {
  relevantReports,
  distance,
  nearestOrder,
  csv,
  type Report,
} from "./domain";
const now = Date.parse("2026-10-16T12:00:00Z");
const report = (extra: Partial<Report> = {}): Report => ({
  id: "r",
  kind: "report",
  revision: 1,
  updatedAt: "2026-10-16T11:00:00Z",
  title: "Crossing blocked",
  siteId: "s",
  severity: "blocked",
  category: "crossing",
  observedAt: "2026-10-16T11:00:00Z",
  expiresAt: "2026-10-16T13:00:00Z",
  vehicle: "Truck",
  notes: "Observe again before leaving",
  authorId: "u",
  verified: false,
  ...extra,
});
describe("access evidence", () => {
  it("requires matching site, relevant vehicle and unexpired observed evidence", () => {
    const rows = [
      report(),
      report({ id: "other", siteId: "t" }),
      report({ id: "van", vehicle: "Van" }),
      report({ id: "expired", expiresAt: "2026-10-16T12:00:00Z" }),
      report({ id: "future", observedAt: "2026-10-16T12:01:00Z" }),
      report({ id: "all", vehicle: "All vehicles" }),
      report({ id: "removed", deleted: true }),
    ];
    expect(
      relevantReports({ siteId: "s", vehicle: "Truck" }, rows, now).map(
        (r) => r.id,
      ),
    ).toEqual(["r", "all"]);
  });
  it("does not require an internal review to surface a blocked observation", () =>
    expect(
      relevantReports(
        { siteId: "s", vehicle: "Truck" },
        [report({ verified: false })],
        now,
      ),
    ).toHaveLength(1));
});
describe("trip planning", () => {
  it("keeps first stop and preserves distinct jobs at the same coordinates", () => {
    const stops = [
      { id: "a", lat: 0, lon: 0 },
      { id: "b", lat: 1, lon: 1 },
      { id: "c", lat: 0, lon: 0 },
    ];
    expect(nearestOrder(stops).map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(stops.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("measures distance sensibly at identical and equatorial positions", () => {
    expect(distance({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
    expect(distance({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(
      111.195,
      2,
    );
  });
});
it("escapes quoted content and spreadsheet formula prefixes", () => {
  expect(csv([{ title: '=HYPERLINK("bad")', notes: "Line\nTwo" }])).toBe(
    '"title","notes"\r\n"\'=HYPERLINK(""bad"")","Line\nTwo"',
  );
});
