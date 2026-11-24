import { afterEach, expect, it, vi } from "vitest";
import { createReplayTuning } from "./replay-tuning";
import { DEFAULT_SETTINGS } from "./settings";
const settings = {
  ...DEFAULT_SETTINGS,
  satellite: 57166,
  tle: "METEOR-M2 3\n1 57166U 23091A   26324.29097177 -.00000005  00000+0  16411-4 0  9991\n2 57166  98.5890  15.9104 0005043  80.5538 279.6211 14.24056900176730",
  latitude: 45.8922,
  longitude: -93.30327,
  altitude: 306.8,
};
const replay = {
  startSeconds: 0,
  durationSeconds: null,
  frequencyOffsetHz: -2607,
  historicalDoppler: true,
  recordingStartUtc: "2026-11-20T15:57:20.118Z",
};
afterEach(() => vi.useRealTimers());
it("uses capture sample time for approach, closest passage and recession", () => {
  const tune = createReplayTuning(settings, replay);
  expect(tune(0).dopplerHz).toBeCloseTo(2999.4006, 2);
  expect(tune(300 * settings.sampleRate).dopplerHz).toBeCloseTo(-125.3453, 2);
  expect(tune(480 * settings.sampleRate).dopplerHz).toBeCloseTo(-2748.2723, 2);
  expect(tune(0).offsetHz).toBeCloseTo(150000 - 2607 + 2999.4006, 2);
});
it("preserves absolute capture time after seeking and when replaying years later", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2035-01-01T00:00:00Z"));
  const fromStart = createReplayTuning(settings, replay),
    fromSeek = createReplayTuning(settings, { ...replay, startSeconds: 280 });
  expect(fromSeek(20 * settings.sampleRate)).toEqual(
    fromStart(300 * settings.sampleRate),
  );
  expect(fromSeek(20 * settings.sampleRate).captureTimeUtc).toBe(
    "2026-11-20T16:02:20.118Z",
  );
  vi.setSystemTime(new Date("2040-05-06T12:34:56Z"));
  expect(fromSeek(20 * settings.sampleRate)).toEqual(
    fromStart(300 * settings.sampleRate),
  );
});
it("rejects missing time, mismatched satellite and TLEs stale at capture time", () => {
  expect(() =>
    createReplayTuning(settings, { ...replay, recordingStartUtc: undefined }),
  ).toThrow(/original capture start/);
  expect(() =>
    createReplayTuning({ ...settings, satellite: 59051 }, replay),
  ).toThrow(/catalog/);
  expect(() =>
    createReplayTuning(settings, {
      ...replay,
      recordingStartUtc: "2026-12-20T15:57:20.118Z",
    }),
  ).toThrow(/14 days/);
});
it("retains exact fixed-offset replay behavior without orbital metadata", () => {
  const tune = createReplayTuning(
    { ...DEFAULT_SETTINGS, tle: "" },
    { startSeconds: 280, durationSeconds: 50, frequencyOffsetHz: -6000 },
  );
  expect(tune(0)).toEqual({
    offsetHz: 144000,
    dopplerHz: 0,
    captureTimeUtc: undefined,
  });
  expect(tune(1000000)).toEqual(tune(0));
});
it("does not double-apply live receiver bias during recorded replay", () => {
  const withLiveBias = createReplayTuning(
    { ...settings, frequencyBiasHz: -2607 },
    replay,
  );
  const withoutLiveBias = createReplayTuning(
    { ...settings, frequencyBiasHz: 0 },
    replay,
  );
  expect(withLiveBias(300 * settings.sampleRate)).toEqual(
    withoutLiveBias(300 * settings.sampleRate),
  );
});
