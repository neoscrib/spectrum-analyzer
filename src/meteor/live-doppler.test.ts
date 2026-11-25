import { expect, it, vi } from "vitest";
import { defaultLiveDoppler } from "./live-doppler";
import { defaults, readSettings, validateSettings } from "../model";
import { importMeteorProfile } from "./profile";
const tle =
  "METEOR-M2 4\n1 59051U 24039A   26323.63845458  .00000023  00000+0  30271-4 0  9998\n2 59051  98.7252 281.1433 0008139  81.1004 279.1095 14.22443947141360";
const now = Date.parse("2026-11-25T15:38:28Z");
it("defaults live Doppler on only with valid matching current elements", () => {
  const options = { ...defaults.meteor, tle };
  expect(defaultLiveDoppler(options, now).doppler).toBe(true);
  expect(defaultLiveDoppler({ ...options, tle: "" }, now).doppler).toBe(false);
  expect(
    defaultLiveDoppler({ ...options, tle: tle.replace("9998", "9999") }, now)
      .doppler,
  ).toBe(false);
  expect(
    defaultLiveDoppler({ ...options, satellite: 57166 }, now).doppler,
  ).toBe(false);
  expect(defaultLiveDoppler(options, now + 20 * 86400000).doppler).toBe(false);
  expect(options.doppler).toBe(false);
});
it("retains explicit on/off choices across TLE refreshes", () => {
  const off = { ...defaults.meteor, tle, dopplerPreference: "off" as const };
  expect(defaultLiveDoppler(off, now).doppler).toBe(false);
  expect(
    defaultLiveDoppler({ ...off, dopplerPreference: "on" }, now).doppler,
  ).toBe(true);
  expect(
    defaultLiveDoppler({ ...off, dopplerPreference: "on", tle: "" }, now)
      .doppler,
  ).toBe(true);
});
it("adopts automatic Doppler for older saved off defaults without losing RF settings", () => {
  const { dopplerPreference: _, ...meteor } = defaults.meteor;
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({
        ...defaults,
        gain: 22.9,
        meteor: { ...meteor, tle, doppler: false },
      }),
  });
  try {
    const migrated = readSettings();
    expect(migrated.gain).toBe(22.9);
    expect(migrated.meteor).toMatchObject({
      doppler: true,
      dopplerPreference: "auto",
    });
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          ...migrated,
          meteor: {
            ...migrated.meteor,
            doppler: false,
            dopplerPreference: "off",
          },
        }),
    });
    expect(readSettings().meteor.doppler).toBe(false);
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
it("preserves older explicit enabled settings while missing TLEs keep automatic defaults off", () => {
  const { dopplerPreference: _, ...meteor } = defaults.meteor;
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({ ...defaults, meteor: { ...meteor, doppler: true } }),
  });
  try {
    expect(readSettings().meteor).toMatchObject({
      doppler: true,
      dopplerPreference: "on",
    });
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({ ...defaults, meteor: { ...meteor, doppler: false } }),
    });
    expect(readSettings().meteor).toMatchObject({
      doppler: false,
      dopplerPreference: "auto",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
it("keeps imported historical capture booleans authoritative instead of applying live defaults", () => {
  const current = { ...defaults, meteor: { ...defaults.meteor, tle } };
  const profile = importMeteorProfile(
    {
      global: {
        "core:datatype": "cu8",
        "core:sample_rate": 2400000,
        "spectrum:meteor": {
          ...current.meteor,
          doppler: false,
          frequency: 137900000,
        },
      },
      captures: [
        {
          "core:sample_start": 0,
          "core:frequency": 137750000,
          "core:datetime": "2026-11-25T15:38:28Z",
        },
      ],
    },
    current,
  );
  expect(profile.settings.meteor).toMatchObject({
    doppler: false,
    dopplerPreference: "off",
  });
  expect(defaultLiveDoppler(profile.settings.meteor, now).doppler).toBe(false);
  expect(profile.options.historicalDoppler).not.toBe(true);
});
it("preserves replay profile options and rejects invalid live preference values", () => {
  const options = {
    startSeconds: 0,
    durationSeconds: null,
    frequencyOffsetHz: -2607,
    autoBias: false,
    historicalDoppler: false,
  };
  const profile = importMeteorProfile(
    {
      schema: "meteor-replay-v1",
      settings: {
        ...defaults.meteor,
        tle,
        frequency: 137900000,
        center: 137750000,
        sampleRate: 2400000,
        replayFormat: "cu8",
        gain: 25.4,
        ppm: 0,
        doppler: false,
      },
      replay: options,
    },
    defaults,
  );
  expect(profile.settings.meteor.dopplerPreference).toBe("off");
  expect(profile.options).toMatchObject(options);
  expect(() =>
    validateSettings({
      ...defaults,
      meteor: { ...defaults.meteor, dopplerPreference: "invalid" as "auto" },
    }),
  ).toThrow(/Doppler preference/);
});
