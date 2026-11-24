import { expect, it } from "vitest";
import { defaults, binRange } from "../model";
import { captureMetadata } from "../recording/model";
import { importMeteorProfile } from "./profile";
import { MeteorImageStore } from "./image-store";
import { decoderTransfers } from "../dsp/decoder-events";
it("maps single-capture Spectrum SigMF data without applying decoder filtering to IQ", () => {
  const settings = {
    ...defaults,
    decoder: "meteor" as const,
    center: 137750000,
    channel: 137900000,
    bandwidth: 180000,
  };
  const metadata = JSON.parse(
    captureMetadata(
      {
        filename: "meteor.cu8",
        settings,
        source: "live",
        startedAt: "2026-11-24T12:00:00Z",
      },
      4800000,
      "Stopped",
    ),
  );
  expect(importMeteorProfile(metadata, settings)).toMatchObject({
    sampleRate: 2400000,
    format: "cu8",
    settings: { center: 137750000, channel: 137900000 },
    options: { frequencyOffsetHz: 0 },
  });
  expect(() =>
    importMeteorProfile(
      { ...metadata, captures: [...metadata.captures, ...metadata.captures] },
      settings,
    ),
  ).toThrow(/single-capture/);
});
it("keeps overlapping patches, black holes and ownership without reallocating every strip", () => {
  const store = new MeteorImageStore();
  const a = store.merge({
    apid: 64,
    width: 1568,
    height: 8,
    startRow: 0,
    pixels: new Uint8Array(1568 * 8).fill(90),
  });
  const b = store.merge({
    apid: 64,
    width: 1568,
    height: 24,
    startRow: 16,
    pixels: new Uint8Array(1568 * 8).fill(120),
  });
  expect(a.pixels.buffer).toBe(b.pixels.buffer);
  expect(b.pixels[0]).toBe(90);
  expect(b.pixels[1568 * 8]).toBe(0);
  expect(b.pixels[1568 * 16]).toBe(120);
  expect(() => store.merge({ ...b, apid: 70 })).toThrow(/Invalid/);
  expect(() => store.merge({ ...b, height: 100000 })).toThrow(/Invalid/);
  const events = [
    { type: "image" as const, protocol: "meteor" as const, image: b },
  ];
  expect(decoderTransfers(events)).toEqual([b.pixels.buffer]);
  store.clear();
  expect(store.images()).toEqual([]);
});
it("uses the actual replay sample rate when cropping FFT bins", () => {
  expect(binRange(0, 100, 8192, 187500, 187500)).toEqual([0, 82]);
  expect(binRange(0, 100, 8192, 93750, 187500)).toEqual([2048, 2089]);
});

it("records and restores Meteor mode, tuning bias and reacquisition with IQ metadata", () => {
  const settings = {
    ...defaults,
    decoder: "meteor" as const,
    center: 137750000,
    channel: 137900000,
    bandwidth: 180000,
    meteor: {
      ...defaults.meteor,
      satellite: 57166,
      frequencyBiasHz: -2607,
      carrierLimitHz: 200,
      reacquireSeconds: 1,
    },
  };
  const metadata = JSON.parse(
    captureMetadata(
      {
        filename: "meteor.cu8",
        settings,
        source: "live",
        startedAt: "2026-11-24T12:00:00Z",
      },
      4800000,
      "Stopped",
    ),
  );
  expect(importMeteorProfile(metadata, defaults)).toMatchObject({
    sampleRate: 2400000,
    format: "cu8",
    settings: {
      channel: 137900000,
      meteor: { satellite: 57166, mode: "oqpsk", nrzm: true },
    },
    options: {
      frequencyOffsetHz: -2607,
      carrierLimitHz: 200,
      reacquireSeconds: 1,
    },
  });
});
