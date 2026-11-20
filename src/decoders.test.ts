import { expect, it } from "vitest";
import { compatibility, decoders, receiverCapabilities } from "./decoders";
import { defaults, validateSettings } from "./model";
import { encodeWwvMinute } from "./dsp/wwv-fixture";

it("declares WWV audio/data requirements independently of WFM", () => {
  const wwv = decoders.find((d) => d.id === "wwv")!;
  expect(wwv.outputs).toEqual(["audio", "timecode", "sync"]);
  expect(compatibility(wwv)).toBeNull();
  expect(
    compatibility({
      ...wwv,
      requirements: { minSampleRate: 6000000, bandwidthHz: 6000000 },
    }),
  ).toContain("Needs 6.0 MSPS");
  expect(receiverCapabilities.minHz).toBe(24000000);
  expect(() =>
    validateSettings({
      ...defaults,
      decoder: "wwv",
      center: 25050000,
      channel: 25000000,
      bandwidth: 10000,
    }),
  ).not.toThrow();
  expect(() =>
    validateSettings({ ...defaults, decoder: "wwv", bandwidth: 200000 }),
  ).toThrow(/WWV channel/);
});
it("encodes the independent NIST diagram example with the correct year-bit positions", () => {
  const bits = encodeWwvMinute(Date.UTC(2001, 0, 173, 21, 10));
  expect(bits.map((b, i) => (b === 1 ? i : -1)).filter((i) => i >= 0)).toEqual([
    4, 15, 20, 26, 30, 31, 35, 36, 37, 40, 50, 56, 57,
  ]);
  expect(bits[0]).toBe(-1);
  expect(bits.map((b, i) => (b === 2 ? i : -1)).filter((i) => i >= 0)).toEqual([
    9, 19, 29, 39, 49, 59,
  ]);
});
it("declares standalone AM as audio-only with independent channel widths", () => {
  const am = decoders.find((d) => d.id === "am")!;
  expect(am.outputs).toEqual(["audio"]);
  expect(am.bandwidths).toEqual([6000, 8000, 10000, 12000, 16000]);
  expect(compatibility(am)).toBeNull();
  expect(() =>
    validateSettings({ ...defaults, decoder: "am", bandwidth: 10000 }),
  ).not.toThrow();
  expect(() =>
    validateSettings({ ...defaults, decoder: "am", bandwidth: 200000 }),
  ).toThrow(/AM channel/);
});
it("declares P25 trunking and reserves the channelizer capture margin", () => {
  const armer = decoders.find((d) => d.id === "armer")!;
  expect(armer.outputs).toEqual(["audio", "telemetry", "message"]);
  expect(compatibility(armer)).toBeNull();
  const settings = {
    ...defaults,
    decoder: "armer" as const,
    center: 852400000,
    channel: 853075000,
    bandwidth: 12500,
  };
  expect(() => validateSettings(settings)).not.toThrow();
  expect(() => validateSettings({ ...settings, channel: 853590000 })).toThrow();
});
