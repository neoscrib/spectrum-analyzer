import { describe, expect, it, vi } from "vitest";
import {
  binRange,
  clampChannel,
  defaults,
  frequencyAt,
  moveCenter,
  SAMPLE_RATE,
  readSettings,
  validateSettings,
} from "./model";
import { spectrum } from "./dsp/spectrum";

describe("independent tuning and displayed bandwidth", () => {
  it("keeps the ARMER control frequency fixed when repositioning the capture", () => {
    const settings = {
      ...defaults,
      decoder: "armer" as const,
      bandwidth: 12500,
      center: 852400000,
      channel: 853075000,
    };
    const moved = moveCenter(settings, 853850000);
    expect(moved.channel).toBe(853075000);
    validateSettings(moved);
  });
  it("changes only display bounds when zooming, preserving FFT frequency mapping", () => {
    const zoomed = { ...defaults, span: 300000 };
    validateSettings(zoomed);
    expect(zoomed.center).toBe(defaults.center);
    expect(zoomed.channel).toBe(defaults.channel);
    expect(frequencyAt(0, 1000, zoomed.center, zoomed.span)).toBe(99_850_000);
    expect(frequencyAt(1000, 1000, zoomed.center, zoomed.span)).toBe(
      100_150_000,
    );
    expect(binRange(0, 1024, 8192, zoomed.span)[0]).toBe(3584);
    expect(binRange(1023, 1024, 8192, zoomed.span)[1]).toBe(4608);
    expect(binRange(0, 1024, 8192, SAMPLE_RATE)[0]).toBe(0);
  });
  it("preserves the decoder's offset on hardware retune", () => {
    expect(moveCenter(defaults, 101e6)).toMatchObject({
      center: 101e6,
      channel: 101.1e6,
      span: SAMPLE_RATE,
    });
  });
  it("rejects a decoder whose channel edges exceed acquisition, and clamps spectrum clicks", () => {
    expect(() =>
      validateSettings({ ...defaults, channel: defaults.center + 1_150_000 }),
    ).toThrow(/whole decoder channel/);
    expect(clampChannel(defaults, 200e6)).toBe(101_100_000);
    expect(clampChannel(defaults, 10e6)).toBe(98_900_000);
    expect(() => validateSettings({ ...defaults, span: 5e6 })).toThrow(
      /Displayed bandwidth/,
    );
    expect(() => validateSettings({ ...defaults, center: NaN })).toThrow(
      /Center frequency/,
    );
    expect(() => validateSettings({ ...defaults, gain: 60 })).toThrow(/Gain/);
  });
});

it("places both positive and negative complex tones at the correct physical frequencies", () => {
  for (const bin of [-1800, 2000]) {
    const size = 8192,
      iq = new Uint8Array(size * 2);
    for (let i = 0; i < size; i++) {
      iq[i * 2] = Math.round(
        127.5 + 70 * Math.cos((2 * Math.PI * bin * i) / size),
      );
      iq[i * 2 + 1] = Math.round(
        127.5 + 70 * Math.sin((2 * Math.PI * bin * i) / size),
      );
    }
    const fft = spectrum(iq, size);
    const peak = fft.indexOf(Math.max(...fft));
    expect(peak).toBe(size / 2 + bin);
    expect(fft[peak]).toBeGreaterThan(-6);
    expect(fft[size / 2]).toBeLessThan(-70);
  }
});

it("preserves saved receiver settings from before the OOK decoder was added", () => {
  const { ook: _, ...previous } = {
    ...defaults,
    decoder: "nfm",
    bandwidth: 12500,
    center: 462400000,
    channel: 462562500,
    gain: 22.9,
  };
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(previous) });
  try {
    const saved = readSettings();
    expect(saved).toMatchObject(previous);
    expect(saved.ook).toEqual(defaults.ook);
    expect(() => validateSettings(saved)).not.toThrow();
  } finally {
    vi.unstubAllGlobals();
  }
});
