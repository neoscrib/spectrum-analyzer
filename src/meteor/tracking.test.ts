import { expect, it } from "vitest";
import {
  dopplerHz,
  lookAt,
  parseTle,
  predictPasses,
  tleAgeDays,
} from "./tracking";
import { DEFAULT_SETTINGS } from "./settings";
const tle =
  "METEOR-M2 4\n1 59051U 24039A   26323.63845458  .00000023  00000+0  30271-4 0  9998\n2 59051  98.7252 281.1433 0008139  81.1004 279.1095 14.22443947141360";
const now = Date.parse("2026-11-19T16:00:00Z");
it("checks TLE identity and checksum instead of accepting unrelated elements", () => {
  expect(() => parseTle(tle, 57166)).toThrow(/catalog/);
  expect(() => parseTle(tle.replace("9998", "9999"))).toThrow(/checksum/);
  expect(tleAgeDays(parseTle(tle), now)).toBeCloseTo(0.0282, 3);
});
it("predicts horizon crossings, a peak and the sky track for Mora", () => {
  const sat = parseTle(tle),
    pass = predictPasses(sat, DEFAULT_SETTINGS, now, 10)[0];
  expect(pass.start).toBeGreaterThan(now);
  expect(pass.end - pass.start).toBeGreaterThan(300000);
  expect(pass.end - pass.start).toBeLessThan(1200000);
  expect(pass.maximum).toBeGreaterThan(10);
  expect(
    Math.abs(lookAt(sat, DEFAULT_SETTINGS, pass.start).elevation),
  ).toBeLessThan(0.01);
  expect(
    Math.abs(lookAt(sat, DEFAULT_SETTINGS, pass.end).elevation),
  ).toBeLessThan(0.01);
  expect(pass.path.length).toBeGreaterThan(50);
});
it("uses opposite Doppler signs on approach and recession", () => {
  const sat = parseTle(tle),
    p = predictPasses(sat, DEFAULT_SETTINGS, now, 30)[0];
  expect(
    dopplerHz(sat, DEFAULT_SETTINGS, p.start + 60000, 137.9e6),
  ).toBeGreaterThan(0);
  expect(dopplerHz(sat, DEFAULT_SETTINGS, p.end - 60000, 137.9e6)).toBeLessThan(
    0,
  );
  expect(
    Math.abs(dopplerHz(sat, DEFAULT_SETTINGS, p.start, 137.9e6)),
  ).toBeLessThan(4000);
});
