import { expect, it } from "vitest";
import {
  DEFAULT_REPLAY,
  importReplayProfile,
  replayRange,
  validateReplay,
} from "./replay";
import { DEFAULT_SETTINGS } from "./settings";

it("selects the recovered raw IQ window without reading its preceding 280 seconds", () => {
  const source = {
    format: "cu8" as const,
    sampleRate: 1200000,
    offset: 0,
    length: 1247805440,
  };
  expect(
    replayRange(source, {
      startSeconds: 280,
      durationSeconds: 50,
      frequencyOffsetHz: -6000,
    }),
  ).toEqual({ offset: 672000000, length: 120000000, stride: 2 });
  expect(() =>
    replayRange(source, { ...DEFAULT_REPLAY, startSeconds: 600 }),
  ).toThrow(/beyond the end/);
});
it("honors WAV data offsets and clips replay at the file end on complete IQ pairs", () => {
  expect(
    replayRange(
      { format: "cs16", sampleRate: 187500, offset: 52, length: 1500000 },
      { ...DEFAULT_REPLAY, startSeconds: 0.5, durationSeconds: 10 },
    ),
  ).toEqual({ offset: 375052, length: 1125000, stride: 4 });
});
it("rejects invalid ranges and tuning outside the recorded bandwidth", () => {
  expect(
    validateReplay({ ...DEFAULT_REPLAY, durationSeconds: 0 }, DEFAULT_SETTINGS),
  ).toMatch(/positive/);
  expect(
    validateReplay({ ...DEFAULT_REPLAY, startSeconds: NaN }, DEFAULT_SETTINGS),
  ).toMatch(/start/);
  expect(
    validateReplay(
      { ...DEFAULT_REPLAY, frequencyOffsetHz: Infinity },
      DEFAULT_SETTINGS,
    ),
  ).toMatch(/frequency/);
  expect(
    validateReplay(
      { ...DEFAULT_REPLAY, frequencyOffsetHz: 100000 },
      { ...DEFAULT_SETTINGS, sampleRate: 240000, center: 137900000 },
    ),
  ).toMatch(/bandwidth/);
});
it("imports recovery controls and the recording's original profile together", () => {
  const imported = importReplayProfile(
    {
      schema: "meteor-replay-v1",
      source: { bytes: 1247805440 },
      settings: {
        ...DEFAULT_SETTINGS,
        satellite: 57166,
        tle: "recorded elements",
      },
      replay: {
        startSeconds: 280,
        durationSeconds: 50,
        frequencyOffsetHz: -6000,
      },
    },
    { ...DEFAULT_SETTINGS, tle: "current elements" },
  );
  expect(imported.options).toEqual({
    startSeconds: 280,
    durationSeconds: 50,
    frequencyOffsetHz: -6000,
    autoBias: true,
  });
  expect(imported.settings).toMatchObject({
    satellite: 57166,
    tle: "recorded elements",
  });
  expect(imported.expectedBytes).toBe(1247805440);
});
it("ordinary capture metadata resets recovery options, and historical Doppler requires capture context", () => {
  expect(
    importReplayProfile(
      { schema: "meteor-iq-v1", settings: DEFAULT_SETTINGS, bytes: 10000 },
      DEFAULT_SETTINGS,
    ).options,
  ).toEqual(DEFAULT_REPLAY);
  expect(() =>
    importReplayProfile(
      {
        schema: "meteor-replay-v1",
        settings: DEFAULT_SETTINGS,
        replay: DEFAULT_REPLAY,
        historicalDoppler: true,
      },
      DEFAULT_SETTINGS,
    ),
  ).toThrow(/original capture start/);
});
it("rejects recovery profiles missing their replay controls", () => {
  expect(() =>
    importReplayProfile(
      { schema: "meteor-replay-v1", settings: DEFAULT_SETTINGS },
      DEFAULT_SETTINGS,
    ),
  ).toThrow(/must include a replay/);
});
it("loads recorded time, Doppler and bias from capture metadata without borrowing the current live bias", () => {
  const tle =
    "METEOR-M2 3\n1 57166U 23091A   26324.29097177 -.00000005  00000+0  16411-4 0  9991\n2 57166  98.5890  15.9104 0005043  80.5538 279.6211 14.24056900176730";
  const imported = importReplayProfile(
    {
      schema: "meteor-iq-v1",
      start: "2026-11-20T15:57:20.118Z",
      bytes: 1156972544,
      settings: { ...DEFAULT_SETTINGS, satellite: 57166, tle },
    },
    { ...DEFAULT_SETTINGS, frequencyBiasHz: -9000 },
  );
  expect(imported.options).toMatchObject({
    historicalDoppler: true,
    recordingStartUtc: "2026-11-20T15:57:20.118Z",
    frequencyOffsetHz: 0,
    reacquireSeconds: 3,
  });
});
it("defaults automatic bias on, defers without recorded Doppler, and respects explicit metadata opt-outs", () => {
  expect(DEFAULT_REPLAY.autoBias).toBe(true);
  expect(validateReplay(DEFAULT_REPLAY, DEFAULT_SETTINGS)).toBeUndefined();
  const profile = {
    schema: "meteor-replay-v1",
    settings: DEFAULT_SETTINGS,
    replay: { ...DEFAULT_REPLAY, autoBias: false },
  };
  expect(importReplayProfile(profile, DEFAULT_SETTINGS).options.autoBias).toBe(
    false,
  );
});
